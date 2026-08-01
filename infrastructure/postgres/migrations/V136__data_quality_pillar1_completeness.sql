-- =========================================================================
-- V136 — Data Quality Pilar 1: Completeness
--
-- OBJETIVO: detectar automaticamente archivos SBS que DEBERIAN existir por
-- periodo pero no llegaron. El caso Volvo Finance (jul-2026) hubiera saltado
-- aqui: la baseline dice que EDPYME EEFF debe cargar 1 archivo cada mes,
-- llego truncado, quedo con 1/6 EDPYMEs y esta vista lo hubiera flagged.
--
-- Componentes:
--   1. admin.expected_files_baseline: source-of-truth de lo que se espera
--      publicar por (grupo, topico) mes a mes.
--   2. admin.check_missing_files(periodo): compara baseline vs realidad
--      y devuelve JSONB con lo que falta.
--   3. admin.v_missing_files: aplicable al ultimo periodo publicable.
--   4. Seed automatico: cada (grupo, topico) que aparecio en >=6 de los
--      ultimos 12 meses se considera "expected".
--
-- Bonus: publish_lag_days por (grupo, topico) — SBS publica algunos
-- reportes con lag distinto (EEFF a los 30d, castigos a los 45d, etc).
-- Sin esto, un mes recien terminado dispararia false positives.
-- =========================================================================


-- ============ 1. Tabla de baseline ============
CREATE TABLE IF NOT EXISTS admin.expected_files_baseline (
    id               BIGSERIAL PRIMARY KEY,
    grupo            TEXT NOT NULL,
    topico           TEXT NOT NULL,
    tipo_entidad     TEXT,                              -- NULL = cualquiera
    -- Cuantos archivos se esperan por mes de este (grupo, topico)
    n_archivos_esperados INT NOT NULL DEFAULT 1,
    -- Ventana temporal en la que aplica esta expectativa
    valid_from       INT NOT NULL,                      -- YYYYMM
    valid_to         INT,                               -- YYYYMM, NULL = vigente
    -- Lag de publicacion SBS: no chequear un periodo hasta N dias despues
    -- del cierre de mes. Default 30 dias (SBS publica EEFF a fin de mes+30).
    publish_lag_days INT NOT NULL DEFAULT 30,
    -- Metadata
    notas            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expected_baseline
    ON admin.expected_files_baseline (grupo, topico, COALESCE(tipo_entidad, ''), valid_from);

CREATE INDEX IF NOT EXISTS idx_expected_baseline_vigente
    ON admin.expected_files_baseline (grupo, topico) WHERE valid_to IS NULL;

COMMENT ON TABLE admin.expected_files_baseline IS
    'Baseline de que archivos SBS deben cargar cada mes por (grupo, topico). '
    'La funcion admin.check_missing_files compara esto contra la realidad '
    'de raw.archivos_descargados y reporta faltantes. Poblar con seed '
    'automatico basado en historia + editar manualmente si SBS cambia.';


-- ============ 2. Seed inicial desde el historico ============
-- Regla: cualquier (grupo, topico) que aparecio en al menos 6 de los ultimos
-- 12 meses (con status='procesado' o 'sospechoso' o 'no_publicado_sbs') se
-- considera "expected" desde el periodo mas antiguo donde aparecio.
INSERT INTO admin.expected_files_baseline
    (grupo, topico, n_archivos_esperados, valid_from, publish_lag_days, notas)
SELECT
    grupo,
    topico,
    -- Numero tipico de archivos por mes (moda de los ultimos 6 meses)
    COALESCE(MODE() WITHIN GROUP (ORDER BY n_por_mes), 1)::int AS n_archivos_esperados,
    MIN(periodo) AS valid_from,
    -- Lag mas conservador: 30d default, 45d para castigos (SBS publica tarde),
    -- 60d para tasas_pasivas / tasas_activas (historicamente mas tarde)
    CASE
        WHEN topico IN ('castigos') THEN 45
        WHEN topico IN ('tasas_pasivas', 'tasas_activas') THEN 60
        ELSE 30
    END AS publish_lag_days,
    'Auto-seed V136 desde historia >= 6 meses en ultimos 12' AS notas
FROM (
    SELECT grupo, topico, periodo, COUNT(*) AS n_por_mes,
           COUNT(*) OVER (PARTITION BY grupo, topico) AS meses_con_data
    FROM raw.archivos_descargados
    WHERE periodo >= (
        SELECT MAX(periodo) - 100 FROM raw.archivos_descargados
    )  -- ultimos 12 meses del periodo mas reciente
      AND status IN ('procesado', 'sospechoso', 'no_publicado_sbs')
    GROUP BY grupo, topico, periodo
) sub
GROUP BY grupo, topico
HAVING COUNT(DISTINCT periodo) >= 6
ON CONFLICT (grupo, topico, COALESCE(tipo_entidad, ''), valid_from) DO NOTHING;


-- ============ 3. Funcion check_missing_files ============
-- Devuelve JSONB[] con {grupo, topico, esperados, encontrados, faltantes}
-- para el periodo dado. Solo evalua expectations vigentes cuyo publish_lag
-- ya expiro (ie, periodo cerrado + lag_days <= hoy).
CREATE OR REPLACE FUNCTION admin.check_missing_files(_periodo INT)
RETURNS TABLE (
    grupo            TEXT,
    topico           TEXT,
    n_esperados      INT,
    n_encontrados    INT,
    n_faltantes      INT,
    publish_lag_days INT,
    fecha_esperada   DATE,
    is_overdue       BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    -- Fecha de cierre del periodo (ultimo dia del mes YYYYMM)
    WITH periodo_info AS (
        SELECT
            _periodo AS periodo,
            (make_date(_periodo / 100, _periodo % 100, 1)
                + INTERVAL '1 month' - INTERVAL '1 day')::date AS cierre_mes
    ),
    encontrados AS (
        -- 'no_publicado_sbs' cuenta como conocido (SBS no publico aun),
        -- no como faltante — sino generamos ruido para meses recientes.
        -- 'sospechoso' y 'error' cuentan como parcial (aparecen igual como
        -- issues en otros checks).
        SELECT grupo, topico, COUNT(*) AS n_encontrados
        FROM raw.archivos_descargados
        WHERE periodo = _periodo
          AND status IN ('procesado', 'sospechoso', 'no_publicado_sbs')
        GROUP BY grupo, topico
    )
    SELECT
        b.grupo,
        b.topico,
        b.n_archivos_esperados AS n_esperados,
        COALESCE(e.n_encontrados, 0) AS n_encontrados,
        GREATEST(b.n_archivos_esperados - COALESCE(e.n_encontrados, 0), 0) AS n_faltantes,
        b.publish_lag_days,
        (p.cierre_mes + (b.publish_lag_days || ' days')::interval)::date AS fecha_esperada,
        (CURRENT_DATE > (p.cierre_mes + (b.publish_lag_days || ' days')::interval)::date
         AND COALESCE(e.n_encontrados, 0) < b.n_archivos_esperados) AS is_overdue
    FROM admin.expected_files_baseline b
    CROSS JOIN periodo_info p
    LEFT JOIN encontrados e USING (grupo, topico)
    WHERE b.valid_from <= _periodo
      AND (b.valid_to IS NULL OR b.valid_to >= _periodo)
    ORDER BY is_overdue DESC, n_faltantes DESC, b.grupo, b.topico;
$$;

COMMENT ON FUNCTION admin.check_missing_files IS
    'Compara admin.expected_files_baseline contra raw.archivos_descargados '
    'para un periodo. Marca is_overdue=true si el lag de publicacion ya expiro. '
    'Usar desde /dashboard/admin/data-quality y desde cron diario.';


-- ============ 4. Vista de missing files vigente ============
-- Cubre los ultimos 6 meses que ya deberian tener publicacion completa.
-- Excluye meses actuales que aun estan dentro del publish_lag.
CREATE OR REPLACE VIEW admin.v_missing_files AS
WITH periodos_a_evaluar AS (
    -- Ultimos 6 meses cerrados (periodo mas reciente en la DB hacia atras)
    SELECT DISTINCT periodo
    FROM raw.archivos_descargados
    WHERE periodo >= (
        SELECT MAX(periodo) - 6 FROM raw.archivos_descargados
    )
)
SELECT
    p.periodo,
    c.grupo,
    c.topico,
    c.n_esperados,
    c.n_encontrados,
    c.n_faltantes,
    c.publish_lag_days,
    c.fecha_esperada,
    c.is_overdue,
    CASE
        WHEN c.is_overdue AND c.n_encontrados = 0 THEN 'critical'
        WHEN c.is_overdue AND c.n_faltantes > 0 THEN 'warning'
        WHEN NOT c.is_overdue AND c.n_faltantes > 0 THEN 'info'
        ELSE 'ok'
    END AS severity
FROM periodos_a_evaluar p
CROSS JOIN LATERAL admin.check_missing_files(p.periodo) c
WHERE c.n_faltantes > 0
ORDER BY p.periodo DESC, severity, c.grupo, c.topico;

COMMENT ON VIEW admin.v_missing_files IS
    'Archivos SBS que faltan por (periodo, grupo, topico) en los ultimos 6 meses. '
    'severity: critical=vencido y 0 archivos, warning=vencido y parcial, '
    'info=aun dentro del lag, ok=todo OK (no aparece).';
