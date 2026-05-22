-- =========================================================================
-- V026: totales L1 sinteticos para balance (A/B/C) en marts
--
-- Problema:
--   La MV marts.mv_eeff_balance_ancho calcula cta_a/b/c como
--   MAX(CASE WHEN cuenta_codigo='A' THEN valor END), pero esos codigos L1
--   NO existen en raw.eeff_observacion (SBS reporta A1, A2, ... no 'A' a secas).
--   Resultado: cta_a, cta_b, cta_c siempre NULL.
--
-- Solucion (sin recrear la MV — operacion costosa):
--   Crear una VISTA marts.v_eeff_balance_ancho que envuelva la MV y reemplace
--   cta_a/b/c por la SUMA de sus hijos L2. El resto de las columnas pasan
--   tal cual. La API del frontend puede apuntar a esta vista cuando quiera
--   los totales sinteticos.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_eeff_balance_ancho AS
SELECT
    periodo,
    fecha_cierre,
    nomb_correg,
    empresa_sbs,
    tipo_entidad,
    microfinanciera,
    nacional,
    moneda,
    -- Pasar todas las columnas cta_* tal cual
    cta_a1, cta_a1_1, cta_a1_2, cta_a1_3, cta_a1_4,
    cta_a2,
    cta_a3, cta_a3_1, cta_a3_2, cta_a3_3, cta_a3_4, cta_a3_5, cta_a3_6, cta_a3_7, cta_a3_8, cta_a3_9,
    cta_a4, cta_a4_1, cta_a4_2, cta_a4_3, cta_a4_4, cta_a4_5,
    cta_a5,
    cta_a6, cta_a6_1, cta_a6_2, cta_a6_3, cta_a6_4, cta_a6_5,
    cta_a7,
    cta_a8,
    cta_a9,
    cta_b1, cta_b1_1, cta_b1_2, cta_b1_3, cta_b1_3_1, cta_b1_3_2, cta_b1_3_3, cta_b1_3_4,
        cta_b1_4, cta_b1_5, cta_b1_5_1, cta_b1_5_2,
    cta_b2, cta_b2_1, cta_b2_2, cta_b2_3,
    cta_b3,
    cta_b4, cta_b4_1, cta_b4_2,
    cta_b5, cta_b5_1, cta_b5_2, cta_b5_3,
    cta_b6,
    cta_b7, cta_b7_1, cta_b7_2, cta_b7_3, cta_b7_4, cta_b7_5, cta_b7_6,
    cta_b8,
    cta_b9, cta_b9_1, cta_b9_2,
    cta_b10,
    cta_c1, cta_c2, cta_c3, cta_c4, cta_c5, cta_c6, cta_c7, cta_c8,
    -- Totales L1 sinteticos: SUMA de hijos L2.
    -- COALESCE para que NULL en algun hijo no anule todo el total
    -- (postgres + sin COALESCE haria que 1 + NULL = NULL).
    COALESCE(cta_a1,0) + COALESCE(cta_a2,0) + COALESCE(cta_a3,0)
        + COALESCE(cta_a4,0) + COALESCE(cta_a5,0) + COALESCE(cta_a6,0)
        + COALESCE(cta_a7,0) + COALESCE(cta_a8,0) + COALESCE(cta_a9,0)
        AS cta_a,
    COALESCE(cta_b1,0) + COALESCE(cta_b2,0) + COALESCE(cta_b3,0)
        + COALESCE(cta_b4,0) + COALESCE(cta_b5,0) + COALESCE(cta_b6,0)
        + COALESCE(cta_b7,0) + COALESCE(cta_b8,0) + COALESCE(cta_b9,0)
        + COALESCE(cta_b10,0)
        AS cta_b,
    COALESCE(cta_c1,0) + COALESCE(cta_c2,0) + COALESCE(cta_c3,0)
        + COALESCE(cta_c4,0) + COALESCE(cta_c5,0) + COALESCE(cta_c6,0)
        + COALESCE(cta_c7,0) + COALESCE(cta_c8,0)
        AS cta_c
FROM marts.mv_eeff_balance_ancho;

COMMENT ON VIEW marts.v_eeff_balance_ancho IS
    'Wrapper sobre mv_eeff_balance_ancho con totales L1 (A/B/C) calculados '
    'como SUMA de hijos L2 — los codigos A/B/C no existen en raw, por eso '
    'la MV los retorna NULL. Esta vista los repara para Analisis Dinamico.';
