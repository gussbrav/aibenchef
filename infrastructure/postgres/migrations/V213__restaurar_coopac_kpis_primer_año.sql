-- =========================================================================
-- V213: Restaurar KPIs PE COOPAC de primer año borrados incorrectamente por V212
--
-- Problema con V212:
--   V212 eliminó KPIs donde "Dec_prev o same_month_prev faltaban". Esto
--   borró también los periodos de "primer año" (ej: MICROWD DIC 2023 = 19.54%)
--   donde AMBOS ytd_dic y ytd_same son NULL. Para esos casos, V196/V199 usaban
--   LEFT JOIN + COALESCE(0), lo cual da:
--
--     TTM(DIC Y) = YTD(DIC Y) + 0 - 0 = YTD(DIC Y)  ← correcto (= año completo)
--
--   El valor distorsionado es el OTRO caso: same_month_prev EXISTE pero
--   Dec_prev NO existe → TTM = YTD - ytd_same (solo el incremento del periodo,
--   no 12 meses). Por eso MICROWD JUN 2026 mostró 3.84% en vez de ~19%.
--
-- Solucion en dos pasos:
--   1. Re-insertar KPIs para periodos donde ambos prior periods faltan (OK).
--   2. Eliminar KPIs donde same_month_prev EXISTE pero Dec_prev NO existe (distorsionado).
--
-- Resultado esperado:
--   - MICROWD DIC 2023 (19.54%) restaurado.
--   - MICROWD JUN 2026 sigue mostrando "—" (Dec 2025 ausente).
-- =========================================================================

-- -----------------------------------------------------------------------
-- PASO 1: Re-insertar KPIs COOPAC de primer año
-- (periodos donde ytd_dic Y ytd_same son NULL — COALESCE 0 da YTD ≈ TTM)
-- Replica exactamente la formula de V199 con cartera bruta corregida.
-- -----------------------------------------------------------------------
INSERT INTO marts.fact_kpis_mensuales (periodo, nomb_correg, moneda, kpi_codigo, valor)
WITH

coopac_periodos AS (
    SELECT DISTINCT r.periodo, r.nomb_correg, 'TOTAL'::text AS moneda
    FROM marts.mv_eeff_resultados_ancho r
    WHERE r.tipo_entidad LIKE 'COOPAC_%'
      AND r.moneda = 'TOTAL'
      -- Solo periodos donde ambos prior periods faltan (primer año de reporte)
      AND NOT EXISTS (
        SELECT 1 FROM marts.mv_eeff_resultados_ancho r2
        WHERE r2.nomb_correg = r.nomb_correg AND r2.moneda = 'TOTAL'
          AND r2.periodo = ((r.periodo / 100 - 1) * 100 + 12)
      )
      AND NOT EXISTS (
        SELECT 1 FROM marts.mv_eeff_resultados_ancho r3
        WHERE r3.nomb_correg = r.nomb_correg AND r3.moneda = 'TOTAL'
          AND r3.periodo = (r.periodo - 100)
      )
),

ytd_cur AS (
    SELECT
        cp.periodo, cp.nomb_correg, cp.moneda,
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

-- Ambos son 0 (ya filtrado en coopac_periodos — no existen en MV)
ttm AS (
    SELECT
        c.periodo, c.nomb_correg, c.moneda,
        c.cta_1_4   AS ttm_1_4,
        c.cta_2     AS ttm_2,
        c.cta_4     AS ttm_4,
        c.cta_10    AS ttm_10,
        c.cta_10_1  AS ttm_10_1,
        c.cta_10_3  AS ttm_10_3,
        c.cta_10_4  AS ttm_10_4,
        c.cta_12_7  AS ttm_12_7,
        c.cta_12_8  AS ttm_12_8,
        c.cta_6     AS ttm_6,
        c.cta_7     AS ttm_7,
        c.cta_8     AS ttm_8,
        c.cta_13    AS ttm_13
    FROM ytd_cur c
),

cartera AS (
    SELECT
        cp.periodo, cp.nomb_correg, cp.moneda,
        AVG(
            COALESCE(b.cta_a4_1, 0) +
            COALESCE(b.cta_a4_2, 0) +
            COALESCE(b.cta_a4_3, 0) +
            GREATEST(COALESCE(b.cta_a4_4, 0), 0)
        ) AS cartera_prom
    FROM coopac_periodos cp
    JOIN marts.v_eeff_balance_ancho b
      ON b.nomb_correg = cp.nomb_correg
     AND b.moneda      = cp.moneda
     AND b.periodo     <= cp.periodo
     AND b.periodo     >= CASE
                            WHEN cp.periodo % 100 = 12
                            THEN cp.periodo - 11
                            ELSE (cp.periodo / 100 - 1) * 100 + (cp.periodo % 100 + 1)
                          END
    WHERE (
        COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0) +
        COALESCE(b.cta_a4_3, 0) + GREATEST(COALESCE(b.cta_a4_4, 0), 0)
    ) > 0
    GROUP BY cp.periodo, cp.nomb_correg, cp.moneda
    HAVING AVG(
        COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0) +
        COALESCE(b.cta_a4_3, 0) + GREATEST(COALESCE(b.cta_a4_4, 0), 0)
    ) > 0
),

kpis AS (
    SELECT
        t.periodo, t.nomb_correg, t.moneda,
        t.ttm_1_4                                             / c.cartera_prom AS rendimiento,
        -t.ttm_2                                              / c.cartera_prom AS costo_fondeo,
        -t.ttm_4                                              / c.cartera_prom AS provisiones,
        -(t.ttm_10 + t.ttm_12_7 + t.ttm_12_8)               / c.cartera_prom AS gastos_op,
        -t.ttm_10_1                                           / c.cartera_prom AS gastos_personal,
        -(t.ttm_10_3 + t.ttm_10_4)                           / c.cartera_prom AS gastos_generales,
        -(t.ttm_12_7 + t.ttm_12_8)                           / c.cartera_prom AS deprec,
        (t.ttm_6 - t.ttm_7 + t.ttm_8 + t.ttm_13)            / c.cartera_prom AS otros
    FROM ttm t
    JOIN cartera c ON c.periodo     = t.periodo
                  AND c.nomb_correg = t.nomb_correg
                  AND c.moneda      = t.moneda
    -- Solo insertar rendimiento != 0 (si es 0, la entidad aun no tenia ingresos)
    WHERE t.ttm_1_4 != 0 OR t.ttm_2 != 0 OR t.ttm_4 != 0 OR t.ttm_10 != 0
)

SELECT
    k.periodo, k.nomb_correg, k.moneda,
    v.kpi_codigo, v.valor
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

-- -----------------------------------------------------------------------
-- PASO 2: Eliminar KPIs donde same_month_prev EXISTE pero Dec_prev NO
-- (esto es el caso realmente distorsionado: TTM = YTD - ytd_same ≠ 12m)
-- Los KPIs de primer año (ambos missing) se conservan del Paso 1.
-- -----------------------------------------------------------------------
DELETE FROM marts.fact_kpis_mensuales
WHERE kpi_codigo LIKE 'pe_%'
  AND (periodo, nomb_correg, moneda) IN (
    SELECT f.periodo, f.nomb_correg, f.moneda
    FROM marts.fact_kpis_mensuales f
    WHERE f.kpi_codigo = 'pe_rendimiento_cartera'
      AND f.moneda = 'TOTAL'
      AND EXISTS (
        SELECT 1 FROM marts.mv_eeff_resultados_ancho r
        WHERE r.nomb_correg = f.nomb_correg AND r.moneda = 'TOTAL'
          AND r.periodo = (f.periodo - 100)
      )
      AND NOT EXISTS (
        SELECT 1 FROM marts.mv_eeff_resultados_ancho r
        WHERE r.nomb_correg = f.nomb_correg AND r.moneda = 'TOTAL'
          AND r.periodo = ((f.periodo / 100 - 1) * 100 + 12)
      )
  );
