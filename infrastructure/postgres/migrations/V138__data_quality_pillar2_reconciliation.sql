-- =========================================================================
-- V138 — Data Quality Pilar 2: Consistency (reconciliacion raw <-> marts)
--
-- OBJETIVO: garantizar que lo que se ve en marts (y por tanto en el UI)
-- refleja fielmente lo cargado en raw. Detecta cuando una MV se olvido de
-- refrescarse o cuando un DELETE en raw no se propago.
--
-- Componentes:
--   1. admin.check_raw_marts_reconciliation(periodo): cuenta entidades por
--      (tipo_estado, moneda) en raw vs mv_eeff_*_ancho y reporta divergencias.
--   2. Nuevo check_type 'reconciliacion_raw_marts' en admin.data_quality_checks.
--   3. Vista admin.v_reconciliacion_recent para /admin/data-quality.
-- =========================================================================


-- ============ 1. Funcion de reconciliacion raw <-> marts ============
CREATE OR REPLACE FUNCTION admin.check_raw_marts_reconciliation(_periodo INT)
RETURNS TABLE (
    tipo_estado    TEXT,
    moneda         TEXT,
    n_raw          BIGINT,
    n_marts        BIGINT,
    delta          BIGINT,
    severity       TEXT,
    detail         TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH raw_agg AS (
        SELECT tipo_estado, moneda, COUNT(DISTINCT nomb_correg) AS n_raw
        FROM raw.eeff_observacion
        WHERE periodo = _periodo AND nomb_correg NOT ILIKE 'TOTAL%'
        GROUP BY tipo_estado, moneda
    ),
    balance_marts AS (
        SELECT 'balance'::text AS tipo_estado, moneda,
               COUNT(DISTINCT nomb_correg) AS n_marts
        FROM marts.v_eeff_balance_ancho
        WHERE periodo = _periodo AND nomb_correg NOT ILIKE 'TOTAL%'
        GROUP BY moneda
    ),
    resultados_marts AS (
        SELECT 'resultados'::text AS tipo_estado, moneda,
               COUNT(DISTINCT nomb_correg) AS n_marts
        FROM marts.mv_eeff_resultados_ancho
        WHERE periodo = _periodo AND nomb_correg NOT ILIKE 'TOTAL%'
        GROUP BY moneda
    ),
    marts_agg AS (
        SELECT * FROM balance_marts UNION ALL SELECT * FROM resultados_marts
    )
    SELECT
        COALESCE(r.tipo_estado, m.tipo_estado) AS tipo_estado,
        COALESCE(r.moneda, m.moneda)           AS moneda,
        COALESCE(r.n_raw, 0)                   AS n_raw,
        COALESCE(m.n_marts, 0)                 AS n_marts,
        (COALESCE(r.n_raw, 0) - COALESCE(m.n_marts, 0)) AS delta,
        CASE
            -- MV con mas filas que raw: MV cacheada de antes de un delete
            WHEN COALESCE(m.n_marts, 0) > COALESCE(r.n_raw, 0)
                THEN 'critical'
            -- Raw con mas filas que MV: refresh olvidado tras un ingest
            WHEN COALESCE(r.n_raw, 0) > COALESCE(m.n_marts, 0)
                THEN 'warning'
            ELSE 'ok'
        END AS severity,
        CASE
            WHEN COALESCE(m.n_marts, 0) > COALESCE(r.n_raw, 0)
                THEN format('MV tiene %s entidades pero raw tiene %s — refresh pendiente tras delete',
                            m.n_marts, r.n_raw)
            WHEN COALESCE(r.n_raw, 0) > COALESCE(m.n_marts, 0)
                THEN format('Raw tiene %s entidades pero MV solo %s — falta REFRESH',
                            r.n_raw, m.n_marts)
            ELSE 'OK'
        END AS detail
    FROM raw_agg r
    FULL OUTER JOIN marts_agg m
        ON r.tipo_estado = m.tipo_estado AND r.moneda = m.moneda;
$$;

COMMENT ON FUNCTION admin.check_raw_marts_reconciliation IS
    'Compara conteo de entidades distintas por (tipo_estado, moneda) '
    'entre raw.eeff_observacion y las MVs marts.v_eeff_balance_ancho / '
    'mv_eeff_resultados_ancho. Sirve para detectar refresh olvidado '
    '(caso real: delete en raw sin refresh de MV deja divergencia).';


-- ============ 2. Vista de reconciliacion reciente ============
CREATE OR REPLACE VIEW admin.v_reconciliacion_recent AS
WITH periodos AS (
    SELECT DISTINCT periodo
    FROM raw.eeff_observacion
    WHERE periodo >= (SELECT MAX(periodo) - 3 FROM raw.eeff_observacion)
)
SELECT p.periodo, r.tipo_estado, r.moneda,
       r.n_raw, r.n_marts, r.delta, r.severity, r.detail
FROM periodos p
CROSS JOIN LATERAL admin.check_raw_marts_reconciliation(p.periodo) r
WHERE r.severity <> 'ok'
ORDER BY p.periodo DESC, r.severity, r.tipo_estado, r.moneda;

COMMENT ON VIEW admin.v_reconciliacion_recent IS
    'Divergencias raw <-> marts en los ultimos 4 meses. severity: '
    'critical=MV mas grande que raw (delete no propagado), warning=raw '
    'mas grande que MV (refresh olvidado).';
