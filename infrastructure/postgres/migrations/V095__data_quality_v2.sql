-- =========================================================================
-- V095: Pipeline Observability V2 — Data Quality (issue #24)
--
-- Agrega chequeos automaticos de COHERENCIA SEMANTICA de los EEFF:
--   1. Balance contable (Activos = Pasivos + Patrimonio) — solo aplica
--      a BANCOS / FINANCIERAS donde la identidad contable es estricta.
--      CMAC/CRAC/EDPYMES tienen estructura SBS distinta donde A9 actúa
--      como total, asi que no podemos validar con esta heuristica sin
--      false positives. Quedan marcados como 'ok' (skip).
--   2. Outliers z-score (valor actual vs media + stddev de los 11 meses
--      previos, por entidad+cuenta).
--   3. Suma subcuentas (jerarquia: padre = SUM(hijos directos)).
--
-- Cada chequeo retorna filas con status (ok/warning/critical) que se
-- persisten en admin.data_quality_checks tras cada import del periodo.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Tabla admin.data_quality_checks — persiste resultados de cada corrida
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin.data_quality_checks (
    id              BIGSERIAL PRIMARY KEY,

    periodo         INT  NOT NULL,
    nomb_correg     TEXT NOT NULL,
    check_type      TEXT NOT NULL
                    CHECK (check_type IN (
                        'balance_contable',
                        'outlier_zscore',
                        'suma_subcuentas'
                    )),
    cuenta_codigo   TEXT,

    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    carga_log_id    BIGINT REFERENCES raw.carga_log(id) ON DELETE SET NULL,

    status          TEXT NOT NULL
                    CHECK (status IN ('ok', 'warning', 'critical')),

    expected_value  NUMERIC,
    actual_value    NUMERIC,
    delta_abs       NUMERIC,
    delta_pct       NUMERIC,
    z_score         NUMERIC,

    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

    reviewed_at     TIMESTAMPTZ,
    reviewed_by     TEXT,
    review_action   TEXT,
    review_notes    TEXT
);

CREATE INDEX IF NOT EXISTS idx_dqc_periodo_status
    ON admin.data_quality_checks (periodo DESC, status, check_type);

CREATE INDEX IF NOT EXISTS idx_dqc_unreviewed
    ON admin.data_quality_checks (detected_at DESC)
    WHERE reviewed_at IS NULL AND status != 'ok';

CREATE INDEX IF NOT EXISTS idx_dqc_entidad
    ON admin.data_quality_checks (nomb_correg, periodo DESC);

COMMENT ON TABLE admin.data_quality_checks IS
    'Resultados de chequeos de coherencia semantica sobre raw.eeff_observacion.
     Una fila por (periodo, entidad, check_type, [cuenta_codigo]). Issue #24.';

-- -------------------------------------------------------------------------
-- 2) Vista marts.v_dq_balance — Check 1 (Balance contable)
--
-- Filosofia conservadora: solo BANCOS y FINANCIERAS validan la identidad
-- contable estricta SUM(A) = SUM(B) + SUM(C). CMACs / CRACs / EDPYMES
-- tienen estructura SBS con A9 acting como total (no como "otros activos")
-- y C6 con doble-conteo — sin formula adaptada por grupo no podemos
-- distinguir bug de structure-by-design. Esos quedan marcados 'ok' (skip).
--
-- Severity:
--   delta_pct < 0.005 → ok
--   delta_pct < 0.05  → warning
--   delta_pct >= 0.05 → critical (balance no cuadra → bug seguro del parser)
--
-- Si el operador investiga y resulta ser feature del archivo SBS, puede
-- marcar la anomalia como 'falsa_alarma' en admin.data_quality_checks.review.
-- -------------------------------------------------------------------------

DROP VIEW IF EXISTS marts.v_dq_balance CASCADE;
CREATE VIEW marts.v_dq_balance AS
WITH base AS (
    SELECT
        eo.periodo,
        eo.nomb_correg,
        eo.tipo_entidad,
        SUM(CASE WHEN eo.cuenta_codigo ~ '^A[0-9]+$' THEN eo.valor END) AS sum_a,
        SUM(CASE WHEN eo.cuenta_codigo ~ '^B[0-9]+$' THEN eo.valor END) AS sum_b,
        SUM(CASE WHEN eo.cuenta_codigo ~ '^C[0-9]+$' THEN eo.valor END) AS sum_c
    FROM raw.eeff_observacion eo
    WHERE eo.tipo_estado = 'balance'
      AND eo.moneda = 'TOTAL'
    GROUP BY eo.periodo, eo.nomb_correg, eo.tipo_entidad
),
computed AS (
    SELECT
        b.periodo,
        b.nomb_correg,
        b.tipo_entidad,
        COALESCE(b.sum_a, 0) AS activos,
        COALESCE(b.sum_b, 0) AS pasivos,
        COALESCE(b.sum_c, 0) AS patrimonio
    FROM base b
)
SELECT
    c.periodo,
    c.nomb_correg,
    c.tipo_entidad,
    c.activos,
    c.pasivos,
    c.patrimonio,
    (c.pasivos + c.patrimonio) AS expected_value,
    c.activos AS actual_value,
    ABS(c.activos - (c.pasivos + c.patrimonio)) AS delta_abs,
    CASE WHEN c.activos = 0 OR c.activos IS NULL THEN NULL
         ELSE ABS(c.activos - (c.pasivos + c.patrimonio)) / c.activos
    END AS delta_pct,
    CASE
        -- Solo BANCOS y FINANCIERAS validan estricto. CMAC/CRAC/EDPYME:
        -- estructura SBS distinta, sin formula adaptada → skip (ok).
        WHEN c.tipo_entidad NOT IN ('BANCOS', 'FINANCIERAS') THEN 'ok'
        WHEN c.activos IS NULL OR c.activos = 0 THEN 'warning'
        WHEN ABS(c.activos - (c.pasivos + c.patrimonio)) / c.activos < 0.005 THEN 'ok'
        WHEN ABS(c.activos - (c.pasivos + c.patrimonio)) / c.activos < 0.05 THEN 'warning'
        ELSE 'critical'
    END AS status
FROM computed c;

COMMENT ON VIEW marts.v_dq_balance IS
    'Check 1 de data quality: verifica Activos = Pasivos + Patrimonio
     para BANCOS y FINANCIERAS (otros grupos quedan skipeados como ok).
     Detecta bugs del parser tipo issue #15. Issue #24.';

-- -------------------------------------------------------------------------
-- 3) Vista marts.v_dq_outliers — Check 2 (Outliers z-score)
-- -------------------------------------------------------------------------

DROP VIEW IF EXISTS marts.v_dq_outliers CASCADE;
CREATE VIEW marts.v_dq_outliers AS
WITH historia AS (
    SELECT
        eo.periodo,
        eo.nomb_correg,
        eo.cuenta_codigo,
        eo.valor,
        AVG(eo.valor) OVER (
            PARTITION BY eo.nomb_correg, eo.cuenta_codigo
            ORDER BY eo.periodo
            ROWS BETWEEN 11 PRECEDING AND 1 PRECEDING
        ) AS media_11m,
        STDDEV_SAMP(eo.valor) OVER (
            PARTITION BY eo.nomb_correg, eo.cuenta_codigo
            ORDER BY eo.periodo
            ROWS BETWEEN 11 PRECEDING AND 1 PRECEDING
        ) AS stddev_11m,
        COUNT(*) OVER (
            PARTITION BY eo.nomb_correg, eo.cuenta_codigo
            ORDER BY eo.periodo
            ROWS BETWEEN 11 PRECEDING AND 1 PRECEDING
        ) AS n_obs_prev
    FROM raw.eeff_observacion eo
    WHERE eo.tipo_estado = 'balance'
      AND eo.moneda = 'TOTAL'
      AND eo.cuenta_codigo ~ '^[ABC][0-9]+$'
)
SELECT
    h.periodo,
    h.nomb_correg,
    h.cuenta_codigo,
    h.valor,
    h.media_11m,
    h.stddev_11m,
    CASE
        WHEN h.stddev_11m IS NULL OR h.stddev_11m = 0 THEN NULL
        ELSE (h.valor - h.media_11m) / h.stddev_11m
    END AS z_score,
    CASE
        WHEN h.n_obs_prev < 6 THEN 'ok'
        WHEN h.stddev_11m IS NULL OR h.stddev_11m = 0 THEN 'ok'
        WHEN ABS((h.valor - h.media_11m) / h.stddev_11m) >= 5 THEN 'critical'
        WHEN ABS((h.valor - h.media_11m) / h.stddev_11m) >= 3 THEN 'warning'
        ELSE 'ok'
    END AS status
FROM historia h;

COMMENT ON VIEW marts.v_dq_outliers IS
    'Check 2: outliers via z-score vs 11 periodos previos. Hubiera detectado
     el caso Mibanco 201906 (SUM(C*) salto de 1.9M a 12.5M, z>>10). Issue #24.';

-- -------------------------------------------------------------------------
-- 4) Vista marts.v_dq_subcuentas — Check 3 (Suma subcuentas)
-- -------------------------------------------------------------------------

DROP VIEW IF EXISTS marts.v_dq_subcuentas CASCADE;
CREATE VIEW marts.v_dq_subcuentas AS
WITH padres_hijos AS (
    SELECT DISTINCT
        h.periodo,
        h.nomb_correg,
        h.tipo_entidad,
        regexp_replace(h.cuenta_codigo, '\.[0-9]+$', '') AS cuenta_padre,
        h.cuenta_codigo AS cuenta_hija,
        h.valor AS valor_hijo
    FROM raw.eeff_observacion h
    WHERE h.tipo_estado = 'balance'
      AND h.moneda = 'TOTAL'
      AND h.cuenta_codigo ~ '\.[0-9]+$'
),
sums AS (
    SELECT
        ph.periodo,
        ph.nomb_correg,
        ph.tipo_entidad,
        ph.cuenta_padre,
        SUM(ph.valor_hijo) AS sum_hijos
    FROM padres_hijos ph
    GROUP BY ph.periodo, ph.nomb_correg, ph.tipo_entidad, ph.cuenta_padre
),
joined AS (
    SELECT
        s.periodo,
        s.nomb_correg,
        s.tipo_entidad,
        s.cuenta_padre AS cuenta_codigo,
        p.valor AS valor_padre,
        s.sum_hijos
    FROM sums s
    JOIN raw.eeff_observacion p
        ON p.periodo = s.periodo
       AND p.nomb_correg = s.nomb_correg
       AND p.cuenta_codigo = s.cuenta_padre
       AND p.tipo_estado = 'balance'
       AND p.moneda = 'TOTAL'
)
SELECT
    j.periodo,
    j.nomb_correg,
    j.cuenta_codigo,
    j.valor_padre AS expected_value,
    j.sum_hijos AS actual_value,
    ABS(j.valor_padre - j.sum_hijos) AS delta_abs,
    CASE WHEN j.valor_padre = 0 OR j.valor_padre IS NULL THEN NULL
         ELSE ABS(j.valor_padre - j.sum_hijos) / ABS(j.valor_padre)
    END AS delta_pct,
    CASE
        -- Solo BANCOS y FIN validan estricto (igual rationale que balance).
        WHEN j.tipo_entidad NOT IN ('BANCOS', 'FINANCIERAS') THEN 'ok'
        WHEN j.valor_padre = 0 OR j.valor_padre IS NULL THEN
            CASE WHEN ABS(j.sum_hijos) < 1.0 THEN 'ok' ELSE 'warning' END
        WHEN ABS(j.valor_padre - j.sum_hijos) / ABS(j.valor_padre) < 0.005 THEN 'ok'
        WHEN ABS(j.valor_padre - j.sum_hijos) / ABS(j.valor_padre) < 0.05 THEN 'warning'
        ELSE 'critical'
    END AS status
FROM joined j;

COMMENT ON VIEW marts.v_dq_subcuentas IS
    'Check 3: padre ≈ SUM(hijos_directos) para cuentas jerarquicas.
     Solo aplica a BANCOS y FINANCIERAS. Issue #24.';
