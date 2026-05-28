-- =========================================================================
-- V100: Extender quality checks balance_contable + suma_subcuentas a TODOS
-- los grupos — issue #38.
--
-- ORIGEN
--
-- Bug critico #36 (cabecera_maestra orden desfasada) afecto data de
-- TODAS las entidades durante meses pero los quality checks NO lo
-- detectaron porque solo aplicaban a BANCOS+FIN.
--
-- Tras V099 las cabeceras estan correctamente alineadas y los chequeos
-- contables son validos para los 5 tipo_entidad. Tras V098 ademas
-- existen los codigos A=TOTAL ACTIVO, B=TOTAL PASIVO en raw, por lo que
-- el balance check ya no necesita formula DUAL heuristica para CMACs.
--
-- FIX
--
-- 1. marts.v_dq_balance — usar codigos A y B directamente (que son los
--    totales reportados por SBS), sin DUAL formula. Aplicar a todos los
--    grupos. Patrimonio se computa como SUM(C[1-9]+) + cta_b9_2 si existe
--    (algunos formatos meten b9_2 fuera del patrimonio).
--
-- 2. marts.v_dq_subcuentas — eliminar exclusion CMAC. Validar todos.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) v_dq_balance — Balance contable para los 5 grupos
-- -------------------------------------------------------------------------

DROP VIEW IF EXISTS marts.v_dq_balance CASCADE;
CREATE VIEW marts.v_dq_balance AS
WITH base AS (
    SELECT
        eo.periodo,
        eo.nomb_correg,
        eo.tipo_entidad,
        -- Totales reportados por SBS post-V098 (A=TOTAL ACTIVO, B=TOTAL PASIVO)
        MAX(CASE WHEN eo.cuenta_codigo = 'A' THEN eo.valor END) AS total_activo,
        MAX(CASE WHEN eo.cuenta_codigo = 'B' THEN eo.valor END) AS total_pasivo,
        -- Patrimonio = SUM(C[1-9]+) (no hay codigo C top-level porque PATRIMONIO
        -- es seccion marker, no total separado en cabecera)
        SUM(CASE WHEN eo.cuenta_codigo ~ '^C[0-9]+$' THEN eo.valor END) AS sum_patrimonio,
        -- Fallback para los formatos antiguos donde A/B no estaban en raw:
        SUM(CASE WHEN eo.cuenta_codigo ~ '^A[0-9]+$' THEN eo.valor END) AS sum_a,
        SUM(CASE WHEN eo.cuenta_codigo ~ '^B[0-9]+$' THEN eo.valor END) AS sum_b
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
        -- Usar codigo A si existe en raw, sino fallback a SUM(A[1-9])
        COALESCE(b.total_activo, b.sum_a, 0) AS activos,
        COALESCE(b.total_pasivo, b.sum_b, 0) AS pasivos,
        COALESCE(b.sum_patrimonio, 0) AS patrimonio
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
        WHEN c.activos IS NULL OR c.activos = 0 THEN 'warning'
        WHEN ABS(c.activos - (c.pasivos + c.patrimonio)) / c.activos < 0.005 THEN 'ok'
        WHEN ABS(c.activos - (c.pasivos + c.patrimonio)) / c.activos < 0.05 THEN 'warning'
        ELSE 'critical'
    END AS status
FROM computed c;

COMMENT ON VIEW marts.v_dq_balance IS
    'Check 1: Activos = Pasivos + Patrimonio para los 5 grupos. Usa codigos
     A=TOTAL ACTIVO, B=TOTAL PASIVO post-V098 directamente; fallback a
     SUM(A[1-9]/B[1-9]) para periodos pre-re-ingest. Issue #38 (mejora #24).';

-- -------------------------------------------------------------------------
-- 2) v_dq_subcuentas — eliminar exclusion CMAC, aplicar a todos
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
        WHEN j.valor_padre = 0 OR j.valor_padre IS NULL THEN
            CASE WHEN ABS(j.sum_hijos) < 1.0 THEN 'ok' ELSE 'warning' END
        WHEN ABS(j.valor_padre - j.sum_hijos) / ABS(j.valor_padre) < 0.005 THEN 'ok'
        WHEN ABS(j.valor_padre - j.sum_hijos) / ABS(j.valor_padre) < 0.05 THEN 'warning'
        ELSE 'critical'
    END AS status
FROM joined j;

COMMENT ON VIEW marts.v_dq_subcuentas IS
    'Check 3: SUM(hijos directos) ≈ padre, para TODOS los grupos
     (eliminado skip CMAC post-V099 que ya alinea cabecera). Issue #38.';
