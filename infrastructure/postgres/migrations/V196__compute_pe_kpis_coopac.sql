-- =========================================================================
-- V196: Compute KPIs Punto de Equilibrio para entidades COOPAC
--
-- PROBLEMA:
--   fact_kpis_mensuales (store del PE) fue populado historicamente solo para
--   entidades SF. Las cooperativas se importaron despues (Fases COOPAC) pero
--   nunca se llamo compute_kpis_punto_equilibrio() para ellas. Por eso no
--   aparecen en el dropdown del PE aunque tienen data en mv_eeff_resultados_ancho.
--
-- SOLUCION:
--   INSERT/UPSERT masivo via SQL set-based (evita el loop plpgsql por
--   eficiencia en migracion). Replica exactamente la formula de V034:
--
--     TTM(cta) = ytd_cur + ytd_dic_prev - ytd_same_prev
--
--   KPIs calculados (10 — mismo set que compute_kpis_punto_equilibrio):
--     pe_rendimiento_cartera  = TTM(1.4)  / cartera_prom
--     pe_costo_fondeo         = -TTM(2)   / cartera_prom
--     pe_costo_provisiones    = -TTM(4)   / cartera_prom
--     pe_gastos_operacionales = -(TTM(10) + TTM(12.7) + TTM(12.8)) / cartera_prom
--     pe_gastos_personal      = -TTM(10.1) / cartera_prom
--     pe_gastos_generales     = -(TTM(10.3) + TTM(10.4)) / cartera_prom
--     pe_deprec_amortiz       = -(TTM(12.7) + TTM(12.8)) / cartera_prom
--     pe_otros_ing_egr        = (TTM(6) - TTM(7) + TTM(8) + TTM(13)) / cartera_prom
--     pe_punto_equilibrio     = costo_fondeo + provisiones + gastos_op
--     pe_margen_neto          = rendimiento + punto_eq + otros
--
--   cartera_prom = AVG(cta_a4) ultimos 12 meses en v_eeff_balance_ancho.
--   Si cartera_prom es NULL o 0 para un (periodo, nomb_correg), la fila
--   se descarta (misma logica que el plpgsql CONTINUE).
--
-- IDEMPOTENTE: ON CONFLICT DO UPDATE — se puede re-aplicar sin riesgo.
--
-- ROLLBACK:
--   DELETE FROM marts.fact_kpis_mensuales
--     WHERE nomb_correg IN (
--       SELECT nomb_correg FROM dw.entidad_maestra
--       WHERE tipo_entidad_actual LIKE 'COOPAC_%'
--     )
--     AND kpi_codigo LIKE 'pe_%';
-- =========================================================================

INSERT INTO marts.fact_kpis_mensuales (periodo, nomb_correg, moneda, kpi_codigo, valor)
WITH

-- Universo: todos los (periodo, nomb_correg) COOPAC en resultados, moneda TOTAL
coopac_periodos AS (
    SELECT DISTINCT periodo, nomb_correg, 'TOTAL'::text AS moneda
    FROM marts.mv_eeff_resultados_ancho
    WHERE tipo_entidad LIKE 'COOPAC_%'
      AND moneda = 'TOTAL'
),

-- YTD del periodo objetivo
ytd_cur AS (
    SELECT
        cp.periodo,
        cp.nomb_correg,
        cp.moneda,
        COALESCE(r.cta_1_4,  0) AS cta_1_4,
        COALESCE(r.cta_2,    0) AS cta_2,
        COALESCE(r.cta_4,    0) AS cta_4,
        COALESCE(r.cta_10,   0) AS cta_10,
        COALESCE(r.cta_10_1, 0) AS cta_10_1,
        COALESCE(r.cta_10_3, 0) AS cta_10_3,
        COALESCE(r.cta_10_4, 0) AS cta_10_4,
        COALESCE(r.cta_12_7, 0) AS cta_12_7,
        COALESCE(r.cta_12_8, 0) AS cta_12_8,
        COALESCE(r.cta_6,    0) AS cta_6,
        COALESCE(r.cta_7,    0) AS cta_7,
        COALESCE(r.cta_8,    0) AS cta_8,
        COALESCE(r.cta_13,   0) AS cta_13
    FROM coopac_periodos cp
    JOIN marts.mv_eeff_resultados_ancho r
      ON r.periodo     = cp.periodo
     AND r.nomb_correg = cp.nomb_correg
     AND r.moneda      = cp.moneda
),

-- YTD Diciembre del año anterior a cada periodo
ytd_dic AS (
    SELECT
        cp.periodo,
        cp.nomb_correg,
        cp.moneda,
        COALESCE(r.cta_1_4,  0) AS cta_1_4,
        COALESCE(r.cta_2,    0) AS cta_2,
        COALESCE(r.cta_4,    0) AS cta_4,
        COALESCE(r.cta_10,   0) AS cta_10,
        COALESCE(r.cta_10_1, 0) AS cta_10_1,
        COALESCE(r.cta_10_3, 0) AS cta_10_3,
        COALESCE(r.cta_10_4, 0) AS cta_10_4,
        COALESCE(r.cta_12_7, 0) AS cta_12_7,
        COALESCE(r.cta_12_8, 0) AS cta_12_8,
        COALESCE(r.cta_6,    0) AS cta_6,
        COALESCE(r.cta_7,    0) AS cta_7,
        COALESCE(r.cta_8,    0) AS cta_8,
        COALESCE(r.cta_13,   0) AS cta_13
    FROM coopac_periodos cp
    LEFT JOIN marts.mv_eeff_resultados_ancho r
      ON r.periodo     = (cp.periodo / 100 - 1) * 100 + 12
     AND r.nomb_correg = cp.nomb_correg
     AND r.moneda      = cp.moneda
),

-- YTD mismo mes del año anterior
ytd_same AS (
    SELECT
        cp.periodo,
        cp.nomb_correg,
        cp.moneda,
        COALESCE(r.cta_1_4,  0) AS cta_1_4,
        COALESCE(r.cta_2,    0) AS cta_2,
        COALESCE(r.cta_4,    0) AS cta_4,
        COALESCE(r.cta_10,   0) AS cta_10,
        COALESCE(r.cta_10_1, 0) AS cta_10_1,
        COALESCE(r.cta_10_3, 0) AS cta_10_3,
        COALESCE(r.cta_10_4, 0) AS cta_10_4,
        COALESCE(r.cta_12_7, 0) AS cta_12_7,
        COALESCE(r.cta_12_8, 0) AS cta_12_8,
        COALESCE(r.cta_6,    0) AS cta_6,
        COALESCE(r.cta_7,    0) AS cta_7,
        COALESCE(r.cta_8,    0) AS cta_8,
        COALESCE(r.cta_13,   0) AS cta_13
    FROM coopac_periodos cp
    LEFT JOIN marts.mv_eeff_resultados_ancho r
      ON r.periodo     = cp.periodo - 100
     AND r.nomb_correg = cp.nomb_correg
     AND r.moneda      = cp.moneda
),

-- TTM = ytd_cur + ytd_dic - ytd_same
ttm AS (
    SELECT
        c.periodo,
        c.nomb_correg,
        c.moneda,
        c.cta_1_4  + d.cta_1_4  - s.cta_1_4  AS ttm_1_4,
        c.cta_2    + d.cta_2    - s.cta_2    AS ttm_2,
        c.cta_4    + d.cta_4    - s.cta_4    AS ttm_4,
        c.cta_10   + d.cta_10   - s.cta_10   AS ttm_10,
        c.cta_10_1 + d.cta_10_1 - s.cta_10_1 AS ttm_10_1,
        c.cta_10_3 + d.cta_10_3 - s.cta_10_3 AS ttm_10_3,
        c.cta_10_4 + d.cta_10_4 - s.cta_10_4 AS ttm_10_4,
        c.cta_12_7 + d.cta_12_7 - s.cta_12_7 AS ttm_12_7,
        c.cta_12_8 + d.cta_12_8 - s.cta_12_8 AS ttm_12_8,
        c.cta_6    + d.cta_6    - s.cta_6    AS ttm_6,
        c.cta_7    + d.cta_7    - s.cta_7    AS ttm_7,
        c.cta_8    + d.cta_8    - s.cta_8    AS ttm_8,
        c.cta_13   + d.cta_13   - s.cta_13   AS ttm_13
    FROM ytd_cur c
    JOIN ytd_dic  d ON d.periodo = c.periodo AND d.nomb_correg = c.nomb_correg AND d.moneda = c.moneda
    JOIN ytd_same s ON s.periodo = c.periodo AND s.nomb_correg = c.nomb_correg AND s.moneda = c.moneda
),

-- Cartera promedio 12 meses (igual que marts.cartera_promedio_12m)
-- Ventana: [periodo_objetivo - 11 meses, periodo_objetivo]
cartera AS (
    SELECT
        cp.periodo,
        cp.nomb_correg,
        cp.moneda,
        AVG(b.cta_a4) AS cartera_prom
    FROM coopac_periodos cp
    JOIN marts.v_eeff_balance_ancho b
      ON b.nomb_correg = cp.nomb_correg
     AND b.moneda      = cp.moneda
     AND b.cta_a4      IS NOT NULL
     AND b.periodo     <= cp.periodo
     AND b.periodo     >= (cp.periodo / 100 - 1) * 100 + (cp.periodo % 100)
    GROUP BY cp.periodo, cp.nomb_correg, cp.moneda
    HAVING AVG(b.cta_a4) IS NOT NULL
       AND AVG(b.cta_a4) <> 0
),

-- KPIs calculados (mismas formulas que V034)
kpis AS (
    SELECT
        t.periodo,
        t.nomb_correg,
        t.moneda,
        t.ttm_1_4                                               / c.cartera_prom AS rendimiento,
        -t.ttm_2                                                / c.cartera_prom AS costo_fondeo,
        -t.ttm_4                                                / c.cartera_prom AS provisiones,
        -(t.ttm_10 + t.ttm_12_7 + t.ttm_12_8)                  / c.cartera_prom AS gastos_op,
        -t.ttm_10_1                                             / c.cartera_prom AS gastos_personal,
        -(t.ttm_10_3 + t.ttm_10_4)                             / c.cartera_prom AS gastos_generales,
        -(t.ttm_12_7 + t.ttm_12_8)                             / c.cartera_prom AS deprec,
        (t.ttm_6 - t.ttm_7 + t.ttm_8 + t.ttm_13)              / c.cartera_prom AS otros
    FROM ttm t
    JOIN cartera c ON c.periodo     = t.periodo
                  AND c.nomb_correg = t.nomb_correg
                  AND c.moneda      = t.moneda
)

-- Pivot de 1 fila por KPI (10 filas por entidad-periodo) via LATERAL VALUES
SELECT
    k.periodo,
    k.nomb_correg,
    k.moneda,
    v.kpi_codigo,
    v.valor
FROM kpis k
CROSS JOIN LATERAL (VALUES
    ('pe_rendimiento_cartera',  k.rendimiento),
    ('pe_costo_fondeo',         k.costo_fondeo),
    ('pe_costo_provisiones',    k.provisiones),
    ('pe_gastos_operacionales', k.gastos_op),
    ('pe_gastos_personal',      k.gastos_personal),
    ('pe_gastos_generales',     k.gastos_generales),
    ('pe_deprec_amortiz',       k.deprec),
    ('pe_otros_ing_egr',        k.otros),
    ('pe_punto_equilibrio',     k.costo_fondeo + k.provisiones + k.gastos_op),
    ('pe_margen_neto',          k.rendimiento + k.costo_fondeo + k.provisiones + k.gastos_op + k.otros)
) AS v(kpi_codigo, valor)
ON CONFLICT (periodo, nomb_correg, moneda, kpi_codigo) DO UPDATE SET
    valor       = EXCLUDED.valor,
    computed_at = now();
