-- V091 — Fix ROE/ROA NULL: usar COALESCE de sub-cuentas para Activos/Patrimonio
--
-- ROOT CAUSE (issue #11):
-- V085 definio cta_a y cta_c en mv_eeff_balance_ancho como
--   MAX(CASE WHEN cuenta_codigo = 'A' THEN valor END)
--   MAX(CASE WHEN cuenta_codigo = 'C' THEN valor END)
-- pero SBS NUNCA publica los codigos agregados 'A' (Activo Total) ni
-- 'C' (Patrimonio Total) — solo publica sub-cuentas:
--   Activos: A1, A2, A3, A4 (+ sub-subs)
--   Patrimonio: C1
--
-- Por lo tanto cta_a y cta_c estan permanentemente NULL → todos los
-- KPIs que dependen de ellos (ROE, ROA, promedios 12m de balance)
-- caen como NULL → frontend muestra "—" en el cuadro resumen.
--
-- FIX:
-- Reescribir las MVs mv_kpis_anuales_entidad y mv_kpis_anuales_historica
-- para que activos = SUM(cta_a o las sub-cuentas A1+A2+A3+A4)
-- y patrimonio = SUM(cta_c o cta_c1).
--
-- NO tocamos mv_eeff_balance_ancho para evitar otro CASCADE blast radius
-- (leccion del issue #8) — el fix es quirurgico aqui en kpis_anuales.

-- ============ MV v_kpis_anuales_entidad (canonica) ============
DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_entidad CASCADE;

CREATE MATERIALIZED VIEW marts.mv_kpis_anuales_entidad AS
WITH er_agg AS (
    SELECT
        periodo,
        dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
        SUM(cta_17)   AS cta_17_ytd,
        SUM(cta_1)    AS cta_1_ytd,
        SUM(cta_2)    AS cta_2_ytd,
        SUM(cta_6)    AS cta_6_ytd,
        SUM(cta_7)    AS cta_7_ytd,
        SUM(cta_10_1) AS cta_10_1_ytd,
        SUM(cta_10_2) AS cta_10_2_ytd,
        SUM(cta_10_3) AS cta_10_3_ytd,
        SUM(cta_10_4) AS cta_10_4_ytd,
        SUM(cta_12_7) AS cta_12_7_ytd,
        SUM(cta_12_8) AS cta_12_8_ytd
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg)
),
ttm AS (
    SELECT
        a.periodo, a.nomb_correg,
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
-- BG_AGG fix: usar COALESCE de sub-cuentas cuando la cuenta agregada
-- no exista. SBS no publica los codigos 'A' y 'C' agregados.
bg_agg AS (
    SELECT periodo,
           dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           SUM(COALESCE(cta_a,
                        COALESCE(cta_a1, 0) + COALESCE(cta_a2, 0) +
                        COALESCE(cta_a3, 0) + COALESCE(cta_a4, 0))) AS activos,
           SUM(COALESCE(cta_c, COALESCE(cta_c1, 0))) AS patrimonio
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg)
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


-- ============ MV v_kpis_anuales_historica ============
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
bg_agg AS (
    SELECT periodo,
           dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           SUM(COALESCE(cta_a,
                        COALESCE(cta_a1, 0) + COALESCE(cta_a2, 0) +
                        COALESCE(cta_a3, 0) + COALESCE(cta_a4, 0))) AS activos,
           SUM(COALESCE(cta_c, COALESCE(cta_c1, 0))) AS patrimonio
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo)
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
    'V091-fix: activos/patrimonio usan COALESCE de sub-cuentas (A1+A2+A3+A4 / C1) '
    'porque SBS no publica los codigos agregados A o C. Antes de V091, '
    'patrimonio_prom_12m y activos_prom_12m eran NULL — rompia ROE/ROA en informe.';
