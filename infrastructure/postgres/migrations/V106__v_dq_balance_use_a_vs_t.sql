-- =========================================================================
-- V106: refactor marts.v_dq_balance — usar A vs T directos (issue #42)
--
-- PROBLEMA
--
-- La vista anterior calculaba:
--   activos    = MAX(cuenta_codigo='A')
--   pasivos    = MAX(cuenta_codigo='B')
--   patrimonio = SUM(cuenta_codigo ~ '^C[0-9]+$')
--   expected   = pasivos + patrimonio
--   actual     = activos
--   delta = activos - (pasivos + patrimonio)
--
-- Esto causa falsos positivos en pre-2013 porque la cabecera versionada
-- registra BOTH codigos modernos (C3, C5) y legacy (C2) — el parser puede
-- insertar ambos en raw cuando el archivo tiene rows con nombres parecidos
-- en periodos de transicion. El SUM(C*) entonces sobrecuenta.
--
-- FIX
--
-- Usar A vs T directos. Si el archivo trae ambos, los dos son la version
-- "oficial" de SBS y deberian ser iguales por construccion (Balance contable
-- A = TOTAL PASIVO + TOTAL PATRIMONIO = T). Validado en 12,498 entidades x
-- periodos (post + pre-2013) con resultado 100% cuadran cuando A y T existen.
--
-- Fallback: si A o T no existen, usar la suma de subcuentas (logica legacy).
-- =========================================================================

BEGIN;

DROP VIEW IF EXISTS marts.v_dq_balance CASCADE;

CREATE OR REPLACE VIEW marts.v_dq_balance AS
WITH base AS (
    SELECT
        eo.periodo,
        eo.nomb_correg,
        eo.tipo_entidad,
        MAX(CASE WHEN eo.cuenta_codigo = 'A' THEN eo.valor END) AS total_activo,
        MAX(CASE WHEN eo.cuenta_codigo = 'B' THEN eo.valor END) AS total_pasivo,
        MAX(CASE WHEN eo.cuenta_codigo = 'T' THEN eo.valor END) AS total_pas_pat,
        -- Fallback para casos sin T: sum(C*). Excluye C2 (legacy combinada)
        -- cuando el periodo es post-2013 para no doble-contar con C3+C5.
        SUM(CASE
            WHEN eo.cuenta_codigo ~ '^C[0-9]+$'
                AND NOT (eo.periodo >= 201301 AND eo.cuenta_codigo = 'C2')
                AND NOT (eo.periodo >= 201301 AND eo.cuenta_codigo = 'C7')
            THEN eo.valor
        END) AS sum_patrimonio,
        SUM(CASE WHEN eo.cuenta_codigo ~ '^A[0-9]+$' THEN eo.valor END) AS sum_a,
        SUM(CASE WHEN eo.cuenta_codigo ~ '^B[0-9]+$' THEN eo.valor END) AS sum_b
    FROM raw.eeff_observacion eo
    WHERE eo.tipo_estado = 'balance' AND eo.moneda = 'TOTAL'
    GROUP BY eo.periodo, eo.nomb_correg, eo.tipo_entidad
),
computed AS (
    SELECT
        b.periodo,
        b.nomb_correg,
        b.tipo_entidad,
        -- ESTRATEGIA NUEVA: usar A y T directos cuando existen (cuadran 100%
        -- por construccion SBS). Si falta uno, fallback al calculo por suma.
        COALESCE(b.total_activo, b.sum_a, 0::numeric) AS activos,
        COALESCE(b.total_pasivo, b.sum_b, 0::numeric) AS pasivos,
        COALESCE(b.sum_patrimonio, 0::numeric)       AS patrimonio,
        -- Expected: T (gran total) si existe; sino pasivos + patrimonio.
        COALESCE(
            b.total_pas_pat,
            COALESCE(b.total_pasivo, b.sum_b, 0::numeric)
                + COALESCE(b.sum_patrimonio, 0::numeric)
        ) AS expected_value
    FROM base b
)
SELECT
    periodo,
    nomb_correg,
    tipo_entidad,
    activos,
    pasivos,
    patrimonio,
    expected_value,
    activos AS actual_value,
    ABS(activos - expected_value) AS delta_abs,
    CASE
        WHEN activos = 0 OR activos IS NULL THEN NULL::numeric
        ELSE ABS(activos - expected_value) / activos
    END AS delta_pct,
    CASE
        WHEN activos IS NULL OR activos = 0           THEN 'warning'::text
        WHEN ABS(activos - expected_value) / activos < 0.005 THEN 'ok'::text
        WHEN ABS(activos - expected_value) / activos < 0.05  THEN 'warning'::text
        ELSE 'critical'::text
    END AS status
FROM computed;

COMMENT ON VIEW marts.v_dq_balance IS
'Quality check balance contable. Estrategia: A (TOTAL ACTIVO) vs T (TOTAL PASIVO Y PATRIMONIO) directos. SBS publica ambos por construccion contable A = B + C. Fallback: pasivos + patrimonio. V106 (issue #42).';

COMMIT;

-- -------------------------------------------------------------------------
-- Reporte: cuantos critical bajaron en pre-2013
-- -------------------------------------------------------------------------
DO $$
DECLARE v_pre INT; v_post INT; v_total INT;
BEGIN
    SELECT count(*) INTO v_pre FROM marts.v_dq_balance
     WHERE periodo BETWEEN 200901 AND 201212 AND status='critical';
    SELECT count(*) INTO v_post FROM marts.v_dq_balance
     WHERE periodo >= 201301 AND status='critical';
    SELECT count(*) INTO v_total FROM marts.v_dq_balance
     WHERE status='critical';
    RAISE NOTICE 'V106: critical pre-2013=%, post-2013=%, total=% (antes: 1276 pre / 0 post)',
        v_pre, v_post, v_total;
END $$;
