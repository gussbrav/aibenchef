-- =========================================================================
-- V137 — Data Quality Pilar 4: Freshness
--
-- OBJETIVO: saber cuando fue el ultimo refresh de cada MV critica y
-- alertar si esta stale. Hoy solo tenemos pg_stat_all_tables.last_autoanalyze
-- que no distingue refresh manual de vacuum automatico. Con esto podemos:
--   1. Auditar tiempo entre imports y visibilidad en dashboards.
--   2. Detectar si un job de refresh murio a la mitad.
--   3. Dar SLA visible en /dashboard/admin/data-quality.
--
-- Componentes:
--   1. admin.mv_refresh_log: append-only, una fila por refresh executed.
--   2. admin.mv_freshness_sla: SLA por MV (default 48h, criticas 24h).
--   3. marts.refresh_all_derived_logged(periodo, concurrent, triggered_by):
--      wrapper que persiste cada step en mv_refresh_log.
--   4. admin.v_data_freshness: age vs SLA por MV con severity.
-- =========================================================================


-- ============ 1. Tabla append-only de refresh log ============
CREATE TABLE IF NOT EXISTS admin.mv_refresh_log (
    id             BIGSERIAL PRIMARY KEY,
    mv_name        TEXT NOT NULL,
    periodo        INT,                       -- NULL si el refresh fue global
    started_at     TIMESTAMPTZ NOT NULL,
    finished_at    TIMESTAMPTZ,
    duration_ms    INT,
    success        BOOLEAN NOT NULL,
    error_message  TEXT,
    triggered_by   TEXT NOT NULL DEFAULT 'unknown',   -- cli:cron, cli:manual, sync_job:123
    rows_after     BIGINT,                    -- opcional: cardinalidad post-refresh
    detail         TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_mv_time
    ON admin.mv_refresh_log (mv_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_time
    ON admin.mv_refresh_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_failed
    ON admin.mv_refresh_log (started_at DESC) WHERE NOT success;

COMMENT ON TABLE admin.mv_refresh_log IS
    'Append-only log de refreshes de MVs. Cada corrida de '
    'marts.refresh_all_derived escribe N filas (una por step). '
    'Sirve para /admin/data-quality (freshness) y postmortems de refresh caidos.';


-- ============ 2. Config de SLA por MV ============
CREATE TABLE IF NOT EXISTS admin.mv_freshness_sla (
    mv_name          TEXT PRIMARY KEY,
    sla_hours        INT NOT NULL DEFAULT 48,      -- default para MVs no criticas
    tier             TEXT NOT NULL DEFAULT 'analytical'
                     CHECK (tier IN ('critical', 'important', 'analytical')),
    notas            TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed inicial: MVs criticas del informe = 24h, resto = 48h
INSERT INTO admin.mv_freshness_sla (mv_name, sla_hours, tier, notas) VALUES
    ('mv_eeff_balance_ancho',       24, 'critical', 'Base de todo el informe'),
    ('mv_eeff_resultados_ancho',    24, 'critical', 'Base de PE y KPIs anuales'),
    ('mv_kpis_anuales_entidad',     24, 'critical', 'Utilidad/ROE/ROA en informe'),
    ('mv_kpis_anuales_historica',   24, 'critical', 'Historicos del informe'),
    ('mv_mora_global_historica',    24, 'critical', 'Cuadro Resumen del informe'),
    ('mv_cobertura_car_historica',  24, 'critical', 'Cuadro Resumen del informe'),
    ('mv_oficinas_por_entidad_canonico',   24, 'critical', 'Cuadro Resumen'),
    ('mv_oficinas_por_entidad_historica',  24, 'critical', 'Cuadro Resumen'),
    ('mv_personal_por_entidad_canonico',   24, 'critical', 'Cuadro Resumen'),
    ('mv_personal_por_entidad_historica',  24, 'critical', 'Cuadro Resumen'),
    ('mv_clientes_por_entidad_canonico',   24, 'critical', 'Cuadro Resumen'),
    ('mv_clientes_por_entidad_historica',  24, 'critical', 'Cuadro Resumen'),
    -- Analiticas: 48h aceptable
    ('mv_castigos_resumen',         48, 'analytical', NULL),
    ('mv_colocaciones_resumen',     48, 'important',  'Base de participacion SMF/SF'),
    ('mv_colocaciones_por_tipo',    48, 'analytical', NULL),
    ('mv_depositos_resumen',        48, 'important',  'Base de participacion SMF/SF depositos'),
    ('mv_clientes_resumen',         48, 'analytical', NULL),
    ('mv_cobertura_geografica',     48, 'analytical', NULL),
    ('mv_creditos_distrito_long',   48, 'analytical', NULL),
    ('mv_eeff_ratios',              48, 'analytical', NULL),
    ('mv_indicadores_prudenciales', 48, 'analytical', NULL),
    ('mv_personal_resumen',         48, 'analytical', NULL),
    ('mv_tasas_activas_resumen',    48, 'analytical', NULL),
    ('mv_tasas_pasivas_resumen',    48, 'analytical', NULL)
ON CONFLICT (mv_name) DO NOTHING;


-- ============ 3. Wrapper logged de refresh_all_derived ============
-- Corre marts.refresh_all_derived(...) y persiste cada step en mv_refresh_log.
-- Mantenemos la firma original (retorna TABLE) para no romper callers.
CREATE OR REPLACE FUNCTION marts.refresh_all_derived_logged(
    p_periodo INT DEFAULT NULL,
    p_concurrent BOOLEAN DEFAULT FALSE,
    p_triggered_by TEXT DEFAULT 'unknown'
)
RETURNS TABLE(
    step_name TEXT,
    duration_ms INT,
    success BOOLEAN,
    detail TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    started_ts TIMESTAMPTZ;
BEGIN
    FOR r IN SELECT * FROM marts.refresh_all_derived(p_periodo, p_concurrent) LOOP
        started_ts := clock_timestamp() - (r.duration_ms || ' milliseconds')::interval;
        INSERT INTO admin.mv_refresh_log (
            mv_name, periodo, started_at, finished_at, duration_ms,
            success, error_message, triggered_by, detail
        ) VALUES (
            r.step_name,
            p_periodo,
            started_ts,
            clock_timestamp(),
            r.duration_ms,
            r.success,
            CASE WHEN r.success THEN NULL ELSE r.detail END,
            p_triggered_by,
            r.detail
        );
        step_name   := r.step_name;
        duration_ms := r.duration_ms;
        success     := r.success;
        detail      := r.detail;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION marts.refresh_all_derived_logged IS
    'Wrapper de marts.refresh_all_derived que persiste cada step en '
    'admin.mv_refresh_log. Usar desde CLI en vez de refresh_all_derived '
    'directo para tener trazabilidad. triggered_by: cli:cron, cli:manual, '
    'sync_job:<id>.';


-- ============ 4. Vista v_data_freshness ============
CREATE OR REPLACE VIEW admin.v_data_freshness AS
WITH last_success AS (
    -- Ultimo refresh exitoso por mv_name
    SELECT DISTINCT ON (mv_name)
        mv_name, finished_at, duration_ms, periodo, triggered_by
    FROM admin.mv_refresh_log
    WHERE success = true
    ORDER BY mv_name, started_at DESC
),
last_any AS (
    -- Ultima corrida (exitosa o no) para diagnostico
    SELECT DISTINCT ON (mv_name)
        mv_name, started_at, success, error_message
    FROM admin.mv_refresh_log
    ORDER BY mv_name, started_at DESC
)
SELECT
    s.mv_name,
    s.tier,
    s.sla_hours,
    ls.finished_at AS last_successful_refresh,
    la.started_at  AS last_any_refresh,
    la.success     AS last_run_success,
    la.error_message AS last_error,
    ls.duration_ms AS last_duration_ms,
    ls.triggered_by AS last_triggered_by,
    EXTRACT(EPOCH FROM (now() - ls.finished_at)) / 3600.0 AS age_hours,
    CASE
        WHEN ls.finished_at IS NULL THEN 'never_refreshed'
        WHEN EXTRACT(EPOCH FROM (now() - ls.finished_at)) / 3600.0 > s.sla_hours * 2
             THEN 'critical'  -- 2x el SLA = critical
        WHEN EXTRACT(EPOCH FROM (now() - ls.finished_at)) / 3600.0 > s.sla_hours
             THEN 'warning'   -- 1x-2x el SLA = warning
        ELSE 'ok'
    END AS severity
FROM admin.mv_freshness_sla s
LEFT JOIN last_success ls USING (mv_name)
LEFT JOIN last_any     la USING (mv_name)
ORDER BY
    CASE
        WHEN s.tier = 'critical'  THEN 1
        WHEN s.tier = 'important' THEN 2
        ELSE 3
    END,
    age_hours DESC NULLS FIRST,
    s.mv_name;

COMMENT ON VIEW admin.v_data_freshness IS
    'Estado de frescura de todas las MVs criticas + analiticas. severity: '
    'critical=age>2xSLA o nunca corrido con log, warning=age>SLA, ok=fresco. '
    'Consumir desde /dashboard/admin/data-quality.';
