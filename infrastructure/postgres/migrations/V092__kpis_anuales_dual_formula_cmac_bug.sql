-- V092 — Fix ROE/ROA divergente Excel: fórmula DUAL detectando bug parser CMAC
--
-- ROOT CAUSE (issue #13):
-- El parser `monthly_eeff_importer` está desalineado vs `dw.cabecera_maestra`
-- para archivos CMAC/CRAC/EDPYME EEFF (offset de +2 ordenes desde el bloque
-- Patrimonio). Esto causa que:
--   - raw.eeff_observacion.cta_b9_2 captura el valor de "TOTAL PASIVO" real
--   - raw.eeff_observacion.cta_a9 y cta_c6 capturan ambos el "TOTAL ACTIVO"
--     y "TOTAL PASIVO Y PATRIMONIO" (que son iguales por balance contable)
--   - Las sub-cuentas C1..C8 capturan valores desplazados (Reservas en C1,
--     Ajustes al Patrimonio en C3, etc) — todas mal etiquetadas.
--
-- Para BANCOS y FINANCIERAS el parser funciona correctamente:
--   - cta_a9 = OTROS ACTIVOS (cuenta hija normal)
--   - cta_c6 = Resultados Acumulados (cuenta hija normal)
--   - Estas SON distintas entre sí.
--
-- DETECTOR DEL BUG:
--   ABS(cta_a9 - cta_c6) < 1.0  → bug presente (CMAC/CRAC/EDPYME pattern)
--
-- FÓRMULA DUAL:
--   activos = bug ? cta_a9 (= TOTAL ACTIVO real)
--                 : SUM(A1..A9)
--   patrimonio = bug ? cta_c6 - cta_b9_2 (= TOTAL P+P - TOTAL PASIVO)
--                    : SUM(C1..C8)
--
-- VALIDACION en DB Hetzner (CMAC Arequipa Apr 2020):
--   cta_a9 = cta_c6 = 6,229,999 → bug detectado
--   cta_b9_2 = 5,480,322 (= TOTAL PASIVO real del archivo SBS)
--   patrimonio = 6,229,999 - 5,480,322 = 749,677
--   Excel: 749,676 ✓ (match exacto)
--
-- NO REQUIERE CAMBIO EN mv_eeff_balance_ancho (evita CASCADE blast radius).
-- Solo redefine mv_kpis_anuales_entidad y mv_kpis_anuales_historica.
--
-- Lectura desde raw.eeff_observacion via subquery (incluye cta_b9_2 que la
-- MV no pivota, sin necesidad de recrearla).
--
-- Refs: issue #13, V091 (fix anterior incompleto), V012 (formula original
-- correcta para BANCOS).

DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_entidad CASCADE;

CREATE MATERIALIZED VIEW marts.mv_kpis_anuales_entidad AS
WITH er_agg AS (
    SELECT periodo,
        dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
        SUM(cta_17)   AS cta_17_ytd, SUM(cta_1) AS cta_1_ytd, SUM(cta_2) AS cta_2_ytd,
        SUM(cta_6)    AS cta_6_ytd,  SUM(cta_7) AS cta_7_ytd,
        SUM(cta_10_1) AS cta_10_1_ytd, SUM(cta_10_2) AS cta_10_2_ytd,
        SUM(cta_10_3) AS cta_10_3_ytd, SUM(cta_10_4) AS cta_10_4_ytd,
        SUM(cta_12_7) AS cta_12_7_ytd, SUM(cta_12_8) AS cta_12_8_ytd
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg)
),
ttm AS (
    SELECT a.periodo, a.nomb_correg,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_17_ytd, 0)
             ELSE COALESCE(a.cta_17_ytd,0) + COALESCE(dp.cta_17_ytd,0) - COALESCE(mp.cta_17_ytd,0) END AS utilidad_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_1_ytd, 0)
             ELSE COALESCE(a.cta_1_ytd,0) + COALESCE(dp.cta_1_ytd,0) - COALESCE(mp.cta_1_ytd,0) END AS cta_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_2_ytd, 0)
             ELSE COALESCE(a.cta_2_ytd,0) + COALESCE(dp.cta_2_ytd,0) - COALESCE(mp.cta_2_ytd,0) END AS cta_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_6_ytd, 0)
             ELSE COALESCE(a.cta_6_ytd,0) + COALESCE(dp.cta_6_ytd,0) - COALESCE(mp.cta_6_ytd,0) END AS cta_6_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_7_ytd, 0)
             ELSE COALESCE(a.cta_7_ytd,0) + COALESCE(dp.cta_7_ytd,0) - COALESCE(mp.cta_7_ytd,0) END AS cta_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_1_ytd, 0)
             ELSE COALESCE(a.cta_10_1_ytd,0) + COALESCE(dp.cta_10_1_ytd,0) - COALESCE(mp.cta_10_1_ytd,0) END AS cta_10_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_2_ytd, 0)
             ELSE COALESCE(a.cta_10_2_ytd,0) + COALESCE(dp.cta_10_2_ytd,0) - COALESCE(mp.cta_10_2_ytd,0) END AS cta_10_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_3_ytd, 0)
             ELSE COALESCE(a.cta_10_3_ytd,0) + COALESCE(dp.cta_10_3_ytd,0) - COALESCE(mp.cta_10_3_ytd,0) END AS cta_10_3_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_4_ytd, 0)
             ELSE COALESCE(a.cta_10_4_ytd,0) + COALESCE(dp.cta_10_4_ytd,0) - COALESCE(mp.cta_10_4_ytd,0) END AS cta_10_4_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_7_ytd, 0)
             ELSE COALESCE(a.cta_12_7_ytd,0) + COALESCE(dp.cta_12_7_ytd,0) - COALESCE(mp.cta_12_7_ytd,0) END AS cta_12_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_8_ytd, 0)
             ELSE COALESCE(a.cta_12_8_ytd,0) + COALESCE(dp.cta_12_8_ytd,0) - COALESCE(mp.cta_12_8_ytd,0) END AS cta_12_8_ttm
    FROM er_agg a
    LEFT JOIN er_agg dp ON dp.nomb_correg = a.nomb_correg AND dp.periodo = (a.periodo / 100 - 1) * 100 + 12
    LEFT JOIN er_agg mp ON mp.nomb_correg = a.nomb_correg AND mp.periodo = a.periodo - 100
),
-- =====================================================================
-- BG_AGG: fórmula DUAL (V092 fix)
-- Lee desde raw.eeff_observacion directamente para incluir cta_b9_2 que
-- la MV mv_eeff_balance_ancho no pivota.
-- =====================================================================
bg_raw AS (
    SELECT periodo,
           dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           cuenta_codigo,
           valor
    FROM raw.eeff_observacion
    WHERE tipo_estado = 'balance' AND moneda = 'TOTAL' AND nomb_correg IS NOT NULL
),
bg_pivot AS (
    SELECT periodo, nomb_correg,
        SUM(CASE WHEN cuenta_codigo = 'A9' THEN valor END) AS cta_a9,
        SUM(CASE WHEN cuenta_codigo = 'C6' THEN valor END) AS cta_c6,
        SUM(CASE WHEN cuenta_codigo = 'B9.2' THEN valor END) AS cta_b9_2,
        SUM(CASE WHEN cuenta_codigo ~ '^A[0-9]+$' THEN valor END) AS sum_a_all,
        SUM(CASE WHEN cuenta_codigo ~ '^C[0-9]+$' THEN valor END) AS sum_c_all
    FROM bg_raw GROUP BY periodo, nomb_correg
),
bg_agg AS (
    SELECT periodo, nomb_correg,
        CASE
            WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                 AND ABS(cta_a9 - cta_c6) < 1.0
            -- BUG CMAC: cta_a9 = cta_c6 = TOTAL ACTIVO/PASIVO+PATRIMONIO
            THEN cta_a9
            ELSE COALESCE(sum_a_all, 0)
        END AS activos,
        CASE
            WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                 AND ABS(cta_a9 - cta_c6) < 1.0
            -- BUG CMAC: patrimonio = TOTAL P+P - TOTAL PASIVO (donde TOTAL PASIVO
            -- está mal etiquetado como B9.2 "Otras Provisiones")
            THEN COALESCE(cta_c6, 0) - COALESCE(cta_b9_2, 0)
            ELSE COALESCE(sum_c_all, 0)
        END AS patrimonio
    FROM bg_pivot
),
bg_avg AS (
    SELECT b.periodo, b.nomb_correg,
           AVG(b_prev.activos) AS activos_prom_12m,
           AVG(b_prev.patrimonio) AS patrimonio_prom_12m
    FROM bg_agg b
    JOIN bg_agg b_prev
        ON b_prev.nomb_correg = b.nomb_correg
       AND b_prev.periodo BETWEEN
            CASE WHEN b.periodo % 100 >= 12 THEN b.periodo - 11
                 ELSE (b.periodo / 100 - 1) * 100 + (b.periodo % 100) + 1 END
            AND b.periodo
    GROUP BY b.periodo, b.nomb_correg
)
SELECT
    t.periodo, t.nomb_correg,
    t.utilidad_ttm, t.cta_1_ttm, t.cta_2_ttm, t.cta_6_ttm, t.cta_7_ttm,
    t.cta_10_1_ttm, t.cta_10_2_ttm, t.cta_10_3_ttm, t.cta_10_4_ttm,
    t.cta_12_7_ttm, t.cta_12_8_ttm,
    bavg.activos_prom_12m, bavg.patrimonio_prom_12m
FROM ttm t
LEFT JOIN bg_avg bavg ON bavg.periodo = t.periodo AND bavg.nomb_correg = t.nomb_correg;

CREATE UNIQUE INDEX IF NOT EXISTS mv_kpis_anuales_pk
    ON marts.mv_kpis_anuales_entidad (periodo, nomb_correg);
CREATE INDEX IF NOT EXISTS mv_kpis_anuales_periodo
    ON marts.mv_kpis_anuales_entidad (periodo);

CREATE OR REPLACE VIEW marts.v_kpis_anuales_entidad AS
SELECT * FROM marts.mv_kpis_anuales_entidad;


-- ============ Historica (raw_to_vigente) ============
DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_historica CASCADE;

CREATE MATERIALIZED VIEW marts.mv_kpis_anuales_historica AS
WITH er_agg AS (
    SELECT periodo,
        dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
        SUM(cta_17)   AS cta_17_ytd, SUM(cta_1) AS cta_1_ytd, SUM(cta_2) AS cta_2_ytd,
        SUM(cta_6)    AS cta_6_ytd,  SUM(cta_7) AS cta_7_ytd,
        SUM(cta_10_1) AS cta_10_1_ytd, SUM(cta_10_2) AS cta_10_2_ytd,
        SUM(cta_10_3) AS cta_10_3_ytd, SUM(cta_10_4) AS cta_10_4_ytd,
        SUM(cta_12_7) AS cta_12_7_ytd, SUM(cta_12_8) AS cta_12_8_ytd
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo)
),
ttm AS (
    SELECT a.periodo, a.nomb_correg,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_17_ytd, 0)
             ELSE COALESCE(a.cta_17_ytd,0) + COALESCE(dp.cta_17_ytd,0) - COALESCE(mp.cta_17_ytd,0) END AS utilidad_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_1_ytd, 0)
             ELSE COALESCE(a.cta_1_ytd,0) + COALESCE(dp.cta_1_ytd,0) - COALESCE(mp.cta_1_ytd,0) END AS cta_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_2_ytd, 0)
             ELSE COALESCE(a.cta_2_ytd,0) + COALESCE(dp.cta_2_ytd,0) - COALESCE(mp.cta_2_ytd,0) END AS cta_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_6_ytd, 0)
             ELSE COALESCE(a.cta_6_ytd,0) + COALESCE(dp.cta_6_ytd,0) - COALESCE(mp.cta_6_ytd,0) END AS cta_6_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_7_ytd, 0)
             ELSE COALESCE(a.cta_7_ytd,0) + COALESCE(dp.cta_7_ytd,0) - COALESCE(mp.cta_7_ytd,0) END AS cta_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_1_ytd, 0)
             ELSE COALESCE(a.cta_10_1_ytd,0) + COALESCE(dp.cta_10_1_ytd,0) - COALESCE(mp.cta_10_1_ytd,0) END AS cta_10_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_2_ytd, 0)
             ELSE COALESCE(a.cta_10_2_ytd,0) + COALESCE(dp.cta_10_2_ytd,0) - COALESCE(mp.cta_10_2_ytd,0) END AS cta_10_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_3_ytd, 0)
             ELSE COALESCE(a.cta_10_3_ytd,0) + COALESCE(dp.cta_10_3_ytd,0) - COALESCE(mp.cta_10_3_ytd,0) END AS cta_10_3_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_4_ytd, 0)
             ELSE COALESCE(a.cta_10_4_ytd,0) + COALESCE(dp.cta_10_4_ytd,0) - COALESCE(mp.cta_10_4_ytd,0) END AS cta_10_4_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_7_ytd, 0)
             ELSE COALESCE(a.cta_12_7_ytd,0) + COALESCE(dp.cta_12_7_ytd,0) - COALESCE(mp.cta_12_7_ytd,0) END AS cta_12_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_8_ytd, 0)
             ELSE COALESCE(a.cta_12_8_ytd,0) + COALESCE(dp.cta_12_8_ytd,0) - COALESCE(mp.cta_12_8_ytd,0) END AS cta_12_8_ttm
    FROM er_agg a
    LEFT JOIN er_agg dp ON dp.nomb_correg = a.nomb_correg AND dp.periodo = (a.periodo / 100 - 1) * 100 + 12
    LEFT JOIN er_agg mp ON mp.nomb_correg = a.nomb_correg AND mp.periodo = a.periodo - 100
),
bg_raw AS (
    SELECT periodo,
           dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           cuenta_codigo,
           valor
    FROM raw.eeff_observacion
    WHERE tipo_estado = 'balance' AND moneda = 'TOTAL' AND nomb_correg IS NOT NULL
),
bg_pivot AS (
    SELECT periodo, nomb_correg,
        SUM(CASE WHEN cuenta_codigo = 'A9' THEN valor END) AS cta_a9,
        SUM(CASE WHEN cuenta_codigo = 'C6' THEN valor END) AS cta_c6,
        SUM(CASE WHEN cuenta_codigo = 'B9.2' THEN valor END) AS cta_b9_2,
        SUM(CASE WHEN cuenta_codigo ~ '^A[0-9]+$' THEN valor END) AS sum_a_all,
        SUM(CASE WHEN cuenta_codigo ~ '^C[0-9]+$' THEN valor END) AS sum_c_all
    FROM bg_raw GROUP BY periodo, nomb_correg
),
bg_agg AS (
    SELECT periodo, nomb_correg,
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                  AND ABS(cta_a9 - cta_c6) < 1.0
            THEN cta_a9
            ELSE COALESCE(sum_a_all, 0)
        END AS activos,
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                  AND ABS(cta_a9 - cta_c6) < 1.0
            THEN COALESCE(cta_c6, 0) - COALESCE(cta_b9_2, 0)
            ELSE COALESCE(sum_c_all, 0)
        END AS patrimonio
    FROM bg_pivot
),
bg_avg AS (
    SELECT b.periodo, b.nomb_correg,
           AVG(b_prev.activos) AS activos_prom_12m,
           AVG(b_prev.patrimonio) AS patrimonio_prom_12m
    FROM bg_agg b
    JOIN bg_agg b_prev ON b_prev.nomb_correg = b.nomb_correg
       AND b_prev.periodo BETWEEN
            CASE WHEN b.periodo % 100 >= 12 THEN b.periodo - 11
                 ELSE (b.periodo / 100 - 1) * 100 + (b.periodo % 100) + 1 END
            AND b.periodo
    GROUP BY b.periodo, b.nomb_correg
)
SELECT t.periodo, t.nomb_correg,
    t.utilidad_ttm, t.cta_1_ttm, t.cta_2_ttm, t.cta_6_ttm, t.cta_7_ttm,
    t.cta_10_1_ttm, t.cta_10_2_ttm, t.cta_10_3_ttm, t.cta_10_4_ttm,
    t.cta_12_7_ttm, t.cta_12_8_ttm,
    bavg.activos_prom_12m, bavg.patrimonio_prom_12m
FROM ttm t
LEFT JOIN bg_avg bavg ON bavg.periodo = t.periodo AND bavg.nomb_correg = t.nomb_correg;

CREATE UNIQUE INDEX IF NOT EXISTS mv_kpis_anuales_hist_pk
    ON marts.mv_kpis_anuales_historica (periodo, nomb_correg);

CREATE OR REPLACE VIEW marts.v_kpis_anuales_historica AS
SELECT * FROM marts.mv_kpis_anuales_historica;

COMMENT ON MATERIALIZED VIEW marts.mv_kpis_anuales_entidad IS
    'V092: fórmula DUAL para activos/patrimonio que detecta el bug del parser '
    'monthly_eeff_importer en archivos CMAC/CRAC/EDPYME (cabecera_maestra '
    'desalineada). Si cta_a9 = cta_c6 (signal de bug), usa la ecuación '
    'contable: activos=cta_a9 (TOTAL ACTIVO real), patrimonio=cta_c6 - cta_b9_2 '
    '(TOTAL P+P - TOTAL PASIVO real). Para BANCOS/FINANCIERAS usa formula '
    'estándar SUM(A1..A9) y SUM(C1..C8). Lee directamente desde raw para '
    'incluir cta_b9_2 sin recrear mv_eeff_balance_ancho.';
