-- =========================================================================
-- V065: Cobertura CAR (%) y % Mora Global con Venta de Cartera (V/C)
--
-- Referencias del Excel "Plantilla PTO EQUILIBRIO.xlsx", hoja
-- "Variables Mibanco":
--
-- 1) %Cob_CAR (r485): cobertura de Cartera de Alto Riesgo
--    = Provisiones / (Cartera Refinanciada + Cartera Atrasada)
--    = ABS(cta_a4_4) / (cta_a4_2 + cta_a4_3)
--    Las cuentas A4.4 (Provisiones) son negativas en el balance SBS, por
--    eso usamos ABS.
--
-- 2) % Mora Global con V/C (r398 + r404):
--    = (Atrasada + Refinanciada + Castigos 12m + Venta Cartera 12m) / Cartera Bruta
--
--    Venta de Cartera (Aprox) (r402-r404):
--      calculo_venta_mes = (cartera_bruta_mes - cartera_bruta_prev_mes)
--                       + castigo_mes
--                       - ganancia_perdida_venta_cartera_mes   (cuenta cta_8)
--      venta_cartera_mes = MAX(0, -calculo_venta_mes)
--    O en lenguaje natural: si la cartera disminuyo mas de lo explicado por
--    castigos y ganancias por venta, la diferencia es venta de cartera
--    aproximada.
--    Venta cartera 12m = SUM(venta_cartera_mes) en los ultimos 12 meses.
-- =========================================================================

-- ---------- COBERTURA CAR ----------
CREATE OR REPLACE VIEW marts.v_cobertura_car_por_entidad AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(cta_a4_2)        AS cartera_refinanciada,
    SUM(cta_a4_3)        AS cartera_atrasada,
    SUM(ABS(cta_a4_4))   AS provisiones,
    CASE
        WHEN SUM(cta_a4_2 + cta_a4_3) > 0
        THEN ROUND(
            (SUM(ABS(cta_a4_4)) / SUM(cta_a4_2 + cta_a4_3))::numeric, 6
        )
        ELSE NULL
    END AS pct_cobertura_car
FROM marts.v_eeff_balance_ancho
WHERE moneda = 'TOTAL'
  AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

COMMENT ON VIEW marts.v_cobertura_car_por_entidad IS
    'Cobertura de Cartera de Alto Riesgo: Provisiones / (Refinanciados + '
    'Atrasados). Replica formula %Cob_CAR del Excel PTO Equilibrio.';


-- ---------- VENTA DE CARTERA MENSUAL (APROX) ----------
-- Auxiliar: castigo mensual por entidad
CREATE OR REPLACE VIEW marts.v_castigos_mes_entidad AS
SELECT
    c.periodo,
    dw.resolver_nomb_correg_canonico(c.entidad) AS nomb_correg,
    SUM(c.saldo_castigos) AS castigo_mes
FROM raw.castigos_observacion c
WHERE c.entidad IS NOT NULL
  AND LOWER(TRIM(c.entidad)) NOT IN ('total general', 'total', '')
GROUP BY c.periodo, dw.resolver_nomb_correg_canonico(c.entidad);


-- Venta de Cartera mes aprox (un valor por entidad/periodo)
CREATE OR REPLACE VIEW marts.v_venta_cartera_mes AS
WITH cartera AS (
    SELECT
        periodo,
        nomb_correg,
        cartera_total
    FROM marts.v_colocaciones_agregado_entidad
),
gpv AS (
    -- Ganancia/Perdida Venta Cartera mensual (cta_8 del ER)
    -- El ER en SBS es YTD; obtener flujo del mes = ytd_mes - ytd_mes_prev
    SELECT
        e.periodo,
        dw.resolver_nomb_correg_canonico(e.nomb_correg) AS nomb_correg,
        SUM(e.cta_8) AS gpv_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda = 'TOTAL' AND e.nomb_correg IS NOT NULL
    GROUP BY e.periodo, dw.resolver_nomb_correg_canonico(e.nomb_correg)
),
gpv_mes AS (
    SELECT
        g.periodo,
        g.nomb_correg,
        -- Si es enero: gpv_mes = gpv_ytd; sino gpv_ytd - gpv_ytd_prev
        CASE
            WHEN g.periodo % 100 = 1 THEN COALESCE(g.gpv_ytd, 0)
            ELSE COALESCE(g.gpv_ytd, 0) - COALESCE(gp.gpv_ytd, 0)
        END AS gpv_mes
    FROM gpv g
    LEFT JOIN gpv gp
      ON gp.nomb_correg = g.nomb_correg
     AND gp.periodo = (g.periodo - 1)  -- mes previo en mismo anio
     AND g.periodo % 100 != 1
)
SELECT
    c.periodo,
    c.nomb_correg,
    -- (cartera_actual - cartera_prev) + castigo_mes - gpv_mes
    -- venta_cartera_mes = MAX(0, -calculo)
    GREATEST(0,
        - (
            COALESCE(c.cartera_total, 0) - COALESCE(cp.cartera_total, 0)
            + COALESCE(cas.castigo_mes, 0)
            - COALESCE(gpv.gpv_mes, 0)
        )
    ) AS venta_cartera_mes
FROM cartera c
LEFT JOIN cartera cp ON cp.nomb_correg = c.nomb_correg AND cp.periodo = (c.periodo - 1)
LEFT JOIN marts.v_castigos_mes_entidad cas
       ON cas.periodo = c.periodo AND cas.nomb_correg = c.nomb_correg
LEFT JOIN gpv_mes gpv ON gpv.periodo = c.periodo AND gpv.nomb_correg = c.nomb_correg;


-- Venta de Cartera 12 meses rolling
CREATE OR REPLACE VIEW marts.v_venta_cartera_12m AS
SELECT
    p.periodo,
    p.nomb_correg,
    COALESCE(SUM(v.venta_cartera_mes), 0) AS venta_cartera_12m
FROM (
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_venta_cartera_mes
) p
LEFT JOIN marts.v_venta_cartera_mes v
    ON v.nomb_correg = p.nomb_correg
   AND v.periodo BETWEEN
        (CASE WHEN p.periodo % 100 >= 12 THEN p.periodo - 11
              ELSE (p.periodo / 100 - 1) * 100 + (p.periodo % 100) + 1 END)
        AND p.periodo
GROUP BY p.periodo, p.nomb_correg;


-- ---------- % MORA GLOBAL CON V/C ----------
-- Reemplaza v_mora_global agregando venta_cartera_12m al numerador.
DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
CREATE VIEW marts.v_mora_global_por_entidad AS
SELECT
    col.periodo,
    col.nomb_correg,
    col.cartera_total                              AS cartera_bruta,
    col.cartera_atrasada,
    col.cartera_refin,
    COALESCE(cas.castigos_12m, 0)                  AS castigos_12m,
    COALESCE(vc.venta_cartera_12m, 0)              AS venta_cartera_12m,
    -- Mora sin V/C
    CASE
        WHEN col.cartera_total > 0
        THEN ROUND(
            ((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
             / col.cartera_total)::numeric, 6)
        ELSE NULL
    END AS pct_mora_global,
    -- Mora con V/C
    CASE
        WHEN col.cartera_total > 0
        THEN ROUND(
            ((col.cartera_atrasada + col.cartera_refin
              + COALESCE(cas.castigos_12m, 0)
              + COALESCE(vc.venta_cartera_12m, 0))
             / col.cartera_total)::numeric, 6)
        ELSE NULL
    END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_entidad col
LEFT JOIN marts.v_castigos_12m_entidad cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_por_entidad IS
    'Mora Global: 2 variantes. pct_mora_global = sin V/C (formula C398 del '
    'Excel). pct_mora_global_vc = con Venta de Cartera 12m (aprox via '
    'cambio en cartera - castigos - GPV/C, fila r402-r404).';
