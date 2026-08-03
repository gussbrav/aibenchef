-- =========================================================================
-- V141 — Report Insights: cache + cost tracking de analisis AI del informe
--
-- OBJETIVO: cada seccion del /dashboard/informe (Margen Neto, Cartera
-- Bruta, Mora Global, etc.) puede tener 3-5 bullets ejecutivos generados
-- por LLM que resumen los hallazgos importantes. Reemplaza el placeholder
-- "Sin comentario ejecutivo para este periodo".
--
-- CACHE (regla clave para bajos costos):
-- Un insight generado sirve a TODOS los usuarios que ven la misma combo:
--   (periodo, seccion, peer_group_hash)
-- Solo se regenera si cambia el peer group o si un admin edita/refresca.
--
-- COST TRACKING:
-- Cada generacion registra tokens_input/output + cost_usd. Vista consolidada
-- por cliente para monitoreo (evita sorpresas de facturacion).
--
-- OVERRIDE MANUAL:
-- Admin puede editar los bullets AI-generados via override_bullets. Si hay
-- override, el UI muestra este en vez del AI (con badge "editado").
-- =========================================================================


-- ============ 1. Tabla principal ============
CREATE TABLE IF NOT EXISTS admin.report_insights (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identidad del insight (para cache lookup)
    periodo             INT NOT NULL,
    seccion             TEXT NOT NULL
                        CHECK (seccion IN (
                            'margen_neto',
                            'cartera_bruta',
                            'mora_global',
                            'cobertura_car',
                            'rendimiento_cartera',
                            'costo_fondeo',
                            'eficiencia',
                            'utilidad_neta',
                            'roe',
                            'roa'
                        )),
    -- Hash SHA-256 de: sorted(peer_group_nomb_correg).join(',') + entidad_propia
    -- Ejemplo: "BCP,Confianza,CMAC-A,CRAC-L,Volvo|BCP" -> sha256
    peer_group_hash     TEXT NOT NULL,
    cliente_slug        TEXT REFERENCES config.cliente(slug) ON DELETE SET NULL,

    -- Output del LLM: array de bullets (strings)
    bullets             TEXT[] NOT NULL DEFAULT '{}',

    -- Metadata del prompt/modelo
    llm_provider_id     UUID REFERENCES admin.llm_providers(id) ON DELETE SET NULL,
    model               TEXT NOT NULL,          -- 'claude-haiku-4-5' (denormalizado por si borran el provider)
    prompt_version      TEXT NOT NULL DEFAULT 'v1',

    -- Datos que se le pasaron al LLM (para debugging + auditoria)
    contexto_json       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Cost tracking
    tokens_input        INT NOT NULL DEFAULT 0,
    tokens_output       INT NOT NULL DEFAULT 0,
    cost_usd            NUMERIC(10, 6) NOT NULL DEFAULT 0,

    -- Timestamps
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_by        TEXT NOT NULL,          -- 'user:email' | 'cron' | 'system'
    duration_ms         INT,

    -- Override manual del admin (si esta seteado, tiene prioridad sobre bullets)
    override_bullets    TEXT[],
    override_reason     TEXT,
    reviewed_at         TIMESTAMPTZ,
    reviewed_by         TEXT
);

-- Cache key: 1 insight por (periodo, seccion, peer_group_hash).
-- Un cliente con el peer default tiene 1 fila; si cambia peer, 1 fila mas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_insights_cache
    ON admin.report_insights (periodo, seccion, peer_group_hash);

CREATE INDEX IF NOT EXISTS idx_report_insights_cliente
    ON admin.report_insights (cliente_slug, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_insights_periodo
    ON admin.report_insights (periodo DESC);

COMMENT ON TABLE admin.report_insights IS
    'Insights AI-generados por seccion del informe. Cache key = '
    '(periodo, seccion, peer_group_hash). Consumido desde el dashboard '
    'via /api/v1/informe/insights. Ver bullets AI vs override_bullets: '
    'UI muestra override si esta seteado.';

COMMENT ON COLUMN admin.report_insights.peer_group_hash IS
    'SHA-256 hex de sorted(peer_group_nombs).join(",")|entidad_propia. '
    'Sirve para invalidar cache si cambia composicion del peer.';


-- ============ 2. Rate limits config (por cliente) ============
-- Extender config.cliente con limites de uso AI. Cada request de generacion
-- chequea estos limites contra el uso mensual/diario y bloquea o alerta.
ALTER TABLE config.cliente
    ADD COLUMN IF NOT EXISTS insights_max_per_month INT NOT NULL DEFAULT 500,
    ADD COLUMN IF NOT EXISTS insights_cost_alert_usd NUMERIC(8, 2) NOT NULL DEFAULT 5.00;

COMMENT ON COLUMN config.cliente.insights_max_per_month IS
    'Rate limit: max generaciones de insights AI por mes calendario. '
    'Cuando se alcanza, /api/v1/informe/insights/generate devuelve 429 '
    'y la UI muestra "limite alcanzado, contacte al admin".';
COMMENT ON COLUMN config.cliente.insights_cost_alert_usd IS
    'Threshold de alerta: si el costo acumulado del mes supera este '
    'monto, se dispara notificacion al admin (V139+ dashboard).';


-- ============ 3. Rate limit por usuario (append-only) ============
CREATE TABLE IF NOT EXISTS admin.insights_user_usage (
    id              BIGSERIAL PRIMARY KEY,
    user_email      TEXT NOT NULL,
    cliente_slug    TEXT,
    periodo         INT NOT NULL,               -- del informe consultado
    seccion         TEXT NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cost_usd        NUMERIC(10, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_insights_usage_user_time
    ON admin.insights_user_usage (user_email, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_usage_cliente_time
    ON admin.insights_user_usage (cliente_slug, generated_at DESC);

COMMENT ON TABLE admin.insights_user_usage IS
    'Log append-only de generaciones AI por usuario. Sirve para rate '
    'limits (max 30/dia por usuario) y para dashboard admin de costos. '
    'Los cache hits NO se registran aca — solo generaciones reales.';


-- ============ 4. Vista de costo consolidado por cliente (mes actual) ============
CREATE OR REPLACE VIEW admin.v_insights_cost_por_cliente AS
WITH mes_actual AS (
    SELECT date_trunc('month', now()) AS inicio
)
SELECT
    COALESCE(ri.cliente_slug, '(sin cliente)') AS cliente_slug,
    COUNT(*)                                    AS n_insights_mes,
    SUM(ri.tokens_input)                        AS tokens_input_total,
    SUM(ri.tokens_output)                       AS tokens_output_total,
    SUM(ri.cost_usd)                            AS cost_usd_mes,
    MAX(ri.generated_at)                        AS ultimo_generado,
    -- Threshold del cliente si esta configurado
    COALESCE(c.insights_cost_alert_usd, 5.00)   AS threshold_alerta,
    COALESCE(c.insights_max_per_month, 500)     AS limite_mes,
    -- Flags de alerta
    (SUM(ri.cost_usd) >= COALESCE(c.insights_cost_alert_usd, 5.00))
        AS cost_alert_disparada
FROM admin.report_insights ri
LEFT JOIN config.cliente c ON c.slug = ri.cliente_slug
CROSS JOIN mes_actual m
WHERE ri.generated_at >= m.inicio
GROUP BY ri.cliente_slug, c.insights_cost_alert_usd, c.insights_max_per_month
ORDER BY cost_usd_mes DESC NULLS LAST;

COMMENT ON VIEW admin.v_insights_cost_por_cliente IS
    'Consumo AI del mes calendario actual agrupado por cliente. '
    'Consumir desde /admin/data-quality (nueva seccion "Costos AI") '
    'y desde alertas de circuit breaker.';


-- ============ 5. Funcion de rate limit check ============
-- Devuelve JSONB con: {allowed: bool, reason: text, remaining_month: int,
-- remaining_day_user: int, cost_month: numeric}
CREATE OR REPLACE FUNCTION admin.check_insights_rate_limit(
    _cliente_slug TEXT,
    _user_email TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _limite_mes INT;
    _uso_mes INT;
    _uso_dia_user INT;
    _cost_mes NUMERIC;
    _MAX_PER_DAY_USER CONSTANT INT := 30;
BEGIN
    -- Buscar limite del cliente
    SELECT COALESCE(insights_max_per_month, 500)
      INTO _limite_mes
      FROM config.cliente WHERE slug = _cliente_slug;
    IF NOT FOUND THEN
        _limite_mes := 500;
    END IF;

    -- Uso del mes calendario actual por el cliente
    SELECT COUNT(*), COALESCE(SUM(cost_usd), 0)
      INTO _uso_mes, _cost_mes
      FROM admin.report_insights
     WHERE cliente_slug = _cliente_slug
       AND generated_at >= date_trunc('month', now());

    -- Uso del dia actual por el usuario
    SELECT COUNT(*) INTO _uso_dia_user
      FROM admin.insights_user_usage
     WHERE user_email = _user_email
       AND generated_at >= date_trunc('day', now());

    -- Chequeos en orden
    IF _uso_dia_user >= _MAX_PER_DAY_USER THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'limite_diario_usuario_alcanzado',
            'remaining_day_user', 0,
            'max_per_day_user', _MAX_PER_DAY_USER
        );
    END IF;

    IF _uso_mes >= _limite_mes THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'limite_mensual_cliente_alcanzado',
            'uso_mes', _uso_mes,
            'limite_mes', _limite_mes
        );
    END IF;

    RETURN jsonb_build_object(
        'allowed', true,
        'remaining_month', _limite_mes - _uso_mes,
        'remaining_day_user', _MAX_PER_DAY_USER - _uso_dia_user,
        'cost_mes', _cost_mes
    );
END;
$$;

COMMENT ON FUNCTION admin.check_insights_rate_limit IS
    'Guardrail: verifica si un usuario+cliente puede generar un insight. '
    'Rate limits: 30/dia por usuario, N/mes por cliente (default 500, '
    'configurable en config.cliente.insights_max_per_month).';
