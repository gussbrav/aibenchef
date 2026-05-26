-- =========================================================================
-- V082: %MG con V/C tambien debe computarse en la vista "historica"
-- (renombres separados).
--
-- Bug: v_mora_global_historica devolvia pct_mora_global_vc = pct_mora_global
-- (sin agregar venta_cartera_12m), por lo que Compartamos Apr 2020 mostraba
-- 7.18% / 7.18% en lugar de 7.18% / 7.70%.
--
-- Fix: crear vistas historicas para a44, castigo_mes, er4_mes y venta_cartera
-- (todas usando dw.raw_to_vigente en lugar de resolver_nomb_correg_canonico),
-- luego actualizar v_mora_global_historica.
-- =========================================================================

DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;

CREATE OR REPLACE VIEW marts.v_a44_provisiones_historica AS
SELECT periodo,
       dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
       SUM(cta_a4_4) AS a44
FROM marts.v_eeff_balance_ancho
WHERE moneda='TOTAL' AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo);

CREATE OR REPLACE VIEW marts.v_castigos_mes_historica AS
SELECT periodo,
       dw.raw_to_vigente(entidad, periodo) AS nomb_correg,
       SUM(saldo_castigos) AS castigo_mes
FROM raw.castigos_observacion
WHERE entidad IS NOT NULL
  AND lower(TRIM(entidad)) <> ALL (ARRAY['total general','total',''])
GROUP BY periodo, dw.raw_to_vigente(entidad, periodo);

CREATE OR REPLACE VIEW marts.v_er4_mes_historica AS
WITH ytd AS (
    SELECT e.periodo,
           dw.raw_to_vigente(e.nomb_correg, e.periodo) AS nomb_correg,
           SUM(e.cta_4) AS er4_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda='TOTAL' AND e.nomb_correg IS NOT NULL
    GROUP BY e.periodo, dw.raw_to_vigente(e.nomb_correg, e.periodo)
)
SELECT y.periodo, y.nomb_correg,
       CASE WHEN (y.periodo % 100) = 1 THEN COALESCE(y.er4_ytd, 0)
            ELSE COALESCE(y.er4_ytd, 0) - COALESCE(yp.er4_ytd, 0)
       END AS er4_mes
FROM ytd y
LEFT JOIN ytd yp ON yp.nomb_correg = y.nomb_correg
                AND yp.periodo = (y.periodo - 1)
                AND (y.periodo % 100) <> 1;


CREATE OR REPLACE VIEW marts.v_venta_cartera_mes_historica AS
SELECT p.periodo, p.nomb_correg,
       GREATEST(0::numeric,
            - (ABS(COALESCE(a.a44, 0)) - ABS(COALESCE(ap.a44, 0))
               + COALESCE(cas.castigo_mes, 0) - COALESCE(er.er4_mes, 0))
       ) AS venta_cartera_mes
FROM (SELECT DISTINCT periodo, nomb_correg FROM marts.v_a44_provisiones_historica) p
LEFT JOIN marts.v_a44_provisiones_historica a
    ON a.periodo = p.periodo AND a.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_a44_provisiones_historica ap
    ON ap.periodo = (p.periodo - 1) AND ap.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_castigos_mes_historica cas
    ON cas.periodo = p.periodo AND cas.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_er4_mes_historica er
    ON er.periodo = p.periodo AND er.nomb_correg = p.nomb_correg;

CREATE OR REPLACE VIEW marts.v_venta_cartera_12m_historica AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(v.venta_cartera_mes), 0) AS venta_cartera_12m
FROM marts.v_colocaciones_agregado_historica u
LEFT JOIN marts.v_venta_cartera_mes_historica v
    ON v.nomb_correg = u.nomb_correg
    AND v.periodo >= CASE
        WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
        ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
    END
    AND v.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;


CREATE OR REPLACE VIEW marts.v_mora_global_historica AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_total AS cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE WHEN col.cartera_total > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0)) / col.cartera_total, 6)
       ELSE NULL END AS pct_mora_global,
       CASE WHEN col.cartera_total > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0) + COALESCE(vc.venta_cartera_12m, 0)) / col.cartera_total, 6)
       ELSE NULL END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m_historica vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_historica IS
    'MG historica por nombre vigente en cada periodo. Incluye venta_cartera_12m '
    'en MG con V/C (igual al canonico).';
