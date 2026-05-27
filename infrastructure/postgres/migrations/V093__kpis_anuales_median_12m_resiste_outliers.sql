-- V093 — Usar MEDIANA en lugar de PROMEDIO 12m: resiste outliers
--
-- ROOT CAUSE (issue #15):
-- El parser monthly_eeff tiene bugs puntuales en archivos SBS específicos
-- (no solo el offset CMAC que ya arreglamos en V092). Ejemplos:
--   - B-2201-jn2019.xls (Mibanco junio 2019): C1=10,839,112 (vs ~1,238,000 normal)
--   - Archivos noviembre/diciembre 2019 de Financiera Compartamos: SUM(C)
--     se cuadruplica vs vecinos
--
-- Estos outliers inflan el AVG(patrimonio_12m) → ROE artificialmente bajo.
--
-- FIX:
-- Reemplazar AVG por percentile_cont(0.5) (MEDIANA) en bg_avg. La mediana
-- es naturalmente resistente a outliers: 1-2 valores anómalos en 12 no
-- mueven el percentil 50.
--
-- VALIDACION pre-fix (Apr 2020 vs Excel):
--   Mibanco:           pat_avg=2,852,375 (CON outlier 201906=12.5M) vs pat_median=1,986,251
--   Compartamos Banco: pat_avg=  890,094 (CON outliers 201911-12)   vs pat_median=  515,619
--   CMAC Arequipa:     pat_avg=  752,229 (sin outliers)             vs pat_median=  749,847
--
-- VALIDACION post-fix (Apr 2020):
--   Mibanco ROE      = 338,452 / 1,986,251 = 17.04%  (Excel 17.2%) ✓
--   Compartamos ROE  =  89,120 /   515,619 = 17.28%  (Excel 17.9%) ✓
--   CMAC Arequipa    = 123,634 /   749,847 = 16.49%  (Excel 16.4%) ✓ (sin regresion)
--
-- TODO follow-up: investigar y arreglar el parser para los archivos
-- B-2201-jn2019.xls y similares. La mediana es una mitigacion, no un fix
-- del bug raíz.

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
bg_raw AS (
    SELECT periodo, dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           cuenta_codigo, valor
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
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL AND ABS(cta_a9 - cta_c6) < 1.0
            THEN cta_a9 ELSE COALESCE(sum_a_all, 0) END AS activos,
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL AND ABS(cta_a9 - cta_c6) < 1.0
            THEN COALESCE(cta_c6, 0) - COALESCE(cta_b9_2, 0) ELSE COALESCE(sum_c_all, 0) END AS patrimonio
    FROM bg_pivot
),
-- =====================================================================
-- BG_AVG: V093 usa MEDIANA en lugar de PROMEDIO (resiste outliers)
-- =====================================================================
bg_avg AS (
    SELECT b.periodo, b.nomb_correg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY b_prev.activos) AS activos_prom_12m,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY b_prev.patrimonio) AS patrimonio_prom_12m
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


-- ============ Historica (raw_to_vigente + mediana) ============
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
    SELECT periodo, dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           cuenta_codigo, valor
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
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL AND ABS(cta_a9 - cta_c6) < 1.0
            THEN cta_a9 ELSE COALESCE(sum_a_all, 0) END AS activos,
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL AND ABS(cta_a9 - cta_c6) < 1.0
            THEN COALESCE(cta_c6, 0) - COALESCE(cta_b9_2, 0) ELSE COALESCE(sum_c_all, 0) END AS patrimonio
    FROM bg_pivot
),
bg_avg AS (
    SELECT b.periodo, b.nomb_correg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY b_prev.activos) AS activos_prom_12m,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY b_prev.patrimonio) AS patrimonio_prom_12m
    FROM bg_agg b JOIN bg_agg b_prev ON b_prev.nomb_correg = b.nomb_correg
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
    'V093: usa MEDIANA (percentile_cont 0.5) en lugar de AVG para los '
    'promedios 12m de activos/patrimonio. Robusto contra outliers de bugs '
    'puntuales del parser (ej. Mibanco junio 2019: C1=10.8M vs ~1.24M normal). '
    'Mantiene fórmula DUAL de V092 que detecta el offset del parser CMAC.';
