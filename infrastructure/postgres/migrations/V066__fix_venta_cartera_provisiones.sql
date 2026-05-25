-- =========================================================================
-- V066: Corrige formula de Venta de Cartera (Aprox) usando PROVISIONES
-- del Balance (A4.4) y del Estado de Resultados (cuenta 4), no cartera
-- bruta + cta_8 como decia V065.
--
-- Formula correcta del Excel PTO Equilibrio (Variables Compartamos r402):
--   calc_venta_mes = (ABS(A4.4_actual) - ABS(A4.4_prev)) + castigo_mes - ER_4_mes
--   venta_cartera_mes = MAX(0, -calc_venta_mes)
--   venta_cartera_12m = SUM(venta_cartera_mes en ultimos 12 meses)
--
-- Donde:
--   A4.4_mes      = Provisiones del Balance (cta_a4_4, valor negativo)
--   ER_4_mes      = Provisiones del ER mensual (cta_4 ytd - cta_4 ytd_prev)
--   castigo_mes   = SUM(raw.castigos.saldo_castigos) del mes
--
-- Logica contable: en ausencia de venta, el cambio en provisiones del
-- balance equivale a ER_provisiones - castigos. Si la diferencia es
-- negativa (provisiones crecieron MENOS de lo esperado por el flujo del
-- ER y los castigos), la diferencia se atribuye a "venta de cartera".
--
-- Validado: Compartamos Abr-20 -> calc = 53, venta_mes = 0 (match Excel).
-- =========================================================================

-- Helper: ER_4 mensual (cta_4 ytd - cta_4 ytd del mes prev), enero = ytd
CREATE OR REPLACE VIEW marts.v_er4_mes_entidad AS
WITH ytd AS (
    SELECT e.periodo,
           dw.resolver_nomb_correg_canonico(e.nomb_correg) AS nomb_correg,
           SUM(e.cta_4) AS er4_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda = 'TOTAL' AND e.nomb_correg IS NOT NULL
    GROUP BY e.periodo, dw.resolver_nomb_correg_canonico(e.nomb_correg)
)
SELECT
    y.periodo,
    y.nomb_correg,
    CASE WHEN y.periodo % 100 = 1 THEN COALESCE(y.er4_ytd, 0)
         ELSE COALESCE(y.er4_ytd, 0) - COALESCE(yp.er4_ytd, 0)
    END AS er4_mes
FROM ytd y
LEFT JOIN ytd yp
       ON yp.nomb_correg = y.nomb_correg
      AND yp.periodo = y.periodo - 1
      AND y.periodo % 100 != 1;


-- Helper: A4.4 (Provisiones del balance) por entidad y periodo
CREATE OR REPLACE VIEW marts.v_a44_provisiones_entidad AS
SELECT
    b.periodo,
    dw.resolver_nomb_correg_canonico(b.nomb_correg) AS nomb_correg,
    SUM(b.cta_a4_4) AS a44
FROM marts.v_eeff_balance_ancho b
WHERE b.moneda = 'TOTAL' AND b.nomb_correg IS NOT NULL
GROUP BY b.periodo, dw.resolver_nomb_correg_canonico(b.nomb_correg);


-- REEMPLAZAR v_venta_cartera_mes con la formula correcta
CREATE OR REPLACE VIEW marts.v_venta_cartera_mes AS
SELECT
    p.periodo,
    p.nomb_correg,
    GREATEST(0,
        -(
            -- (ABS(A4.4_actual) - ABS(A4.4_prev))
            (ABS(COALESCE(a.a44, 0)) - ABS(COALESCE(ap.a44, 0)))
            -- + castigo_mes
            + COALESCE(cas.castigo_mes, 0)
            -- - ER_4_mes
            - COALESCE(er.er4_mes, 0)
        )
    ) AS venta_cartera_mes
FROM (
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_a44_provisiones_entidad
) p
LEFT JOIN marts.v_a44_provisiones_entidad a
       ON a.periodo = p.periodo AND a.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_a44_provisiones_entidad ap
       ON ap.periodo = p.periodo - 1 AND ap.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_castigos_mes_entidad cas
       ON cas.periodo = p.periodo AND cas.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_er4_mes_entidad er
       ON er.periodo = p.periodo AND er.nomb_correg = p.nomb_correg;

COMMENT ON VIEW marts.v_venta_cartera_mes IS
    'Venta de Cartera mes (aprox) replicando la formula r402 del Excel '
    'PTO Equilibrio: (delta ABS(A4.4) + castigo_mes - ER_4_mes), tomada '
    'como venta solo cuando el signo invertido es positivo.';


-- Recrear v_venta_cartera_12m (depende de la vista anterior, ya estaba
-- definido en V065 — la dependencia se mantiene)
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


-- Recrear v_mora_global_por_entidad (mismas columnas, vista refresh)
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
    CASE
        WHEN col.cartera_total > 0
        THEN ROUND(
            ((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
             / col.cartera_total)::numeric, 6)
        ELSE NULL
    END AS pct_mora_global,
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
