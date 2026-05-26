-- =========================================================================
-- V081: Fix castigos_12m para incluir TODOS los periodos donde la entidad
-- tiene colocaciones, no solo donde la SBS publico castigos.
--
-- Bug: la SBS publica castigos de manera trimestral (solo 03/06/09/12).
-- La vista anterior tomaba como universo (periodo, entidad) las filas
-- presentes en raw.castigos_observacion. Asi, para periodos como 202004
-- (Abr 2020) la entidad no aparecia y castigos_12m quedaba en 0 via el
-- COALESCE del JOIN externo en v_mora_global_*.
--
-- Validacion contra Excel oficial Abr 2020:
--   Mibanco Castigos 12m: 363,514 (Excel) ✓ DB raw suma da 363,514
--   Pero v_castigos_12m_entidad daba 0 -> %MG sin V/C: 6.00% (DB) vs 9.36% (Excel)
--   Despues del fix esperado: %MG sin V/C = 9.36% MATCH.
--
-- Fix: usar marts.v_colocaciones_agregado_entidad/historica como universo
-- (tiene una fila por entidad por cada periodo de balance, incluyendo los
-- meses donde no hay publicacion de castigos trimestrales).
-- =========================================================================

DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;
DROP VIEW IF EXISTS marts.v_castigos_12m_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_castigos_12m_historica CASCADE;


-- ============ CANONICA ============
CREATE OR REPLACE VIEW marts.v_castigos_12m_entidad AS
SELECT u.periodo,
       u.nomb_correg,
       COALESCE(SUM(c.saldo_castigos), 0::numeric) AS castigos_12m
FROM marts.v_colocaciones_agregado_entidad u
LEFT JOIN raw.castigos_observacion c
  ON dw.resolver_nomb_correg_canonico(c.entidad) = u.nomb_correg
  AND c.entidad IS NOT NULL
  AND lower(TRIM(c.entidad)) <> ALL (ARRAY['total general','total',''])
  AND c.periodo >= CASE
      WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
      ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
  END
  AND c.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;

COMMENT ON VIEW marts.v_castigos_12m_entidad IS
    'Suma de castigos en los ultimos 12 meses calendario por entidad canonica. '
    'Universo: todas las (periodo, entidad) donde hay colocaciones (no solo donde '
    'la SBS publico castigos en ese trimestre).';


-- ============ HISTORICA ============
CREATE OR REPLACE VIEW marts.v_castigos_12m_historica AS
SELECT u.periodo,
       u.nomb_correg,
       COALESCE(SUM(c.saldo_castigos), 0::numeric) AS castigos_12m
FROM marts.v_colocaciones_agregado_historica u
LEFT JOIN raw.castigos_observacion c
  ON dw.raw_to_vigente(c.entidad, u.periodo) = u.nomb_correg
  AND c.entidad IS NOT NULL
  AND lower(TRIM(c.entidad)) <> ALL (ARRAY['total general','total',''])
  AND c.periodo >= CASE
      WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
      ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
  END
  AND c.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;

COMMENT ON VIEW marts.v_castigos_12m_historica IS
    'Castigos 12m por entidad usando nombre vigente en cada periodo (renombres separados).';


-- ============ MORA GLOBAL CANONICA ============
CREATE OR REPLACE VIEW marts.v_mora_global_por_entidad AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_total AS cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE
           WHEN col.cartera_total > 0::numeric THEN
               round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0::numeric)) / col.cartera_total, 6)
           ELSE NULL::numeric
       END AS pct_mora_global,
       CASE
           WHEN col.cartera_total > 0::numeric THEN
               round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0::numeric) + COALESCE(vc.venta_cartera_12m, 0::numeric)) / col.cartera_total, 6)
           ELSE NULL::numeric
       END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_entidad col
LEFT JOIN marts.v_castigos_12m_entidad cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_por_entidad IS
    'Mora Global = (Atrasada + Refinanciada + Castigos12m) / Cartera Bruta. '
    'MG con V/C: agrega Venta Cartera 12m al numerador. Formula del directorio.';


-- ============ MORA GLOBAL HISTORICA ============
CREATE OR REPLACE VIEW marts.v_mora_global_historica AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_total AS cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       CASE
           WHEN col.cartera_total > 0::numeric THEN
               round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0::numeric)) / col.cartera_total, 6)
           ELSE NULL::numeric
       END AS pct_mora_global,
       CASE
           WHEN col.cartera_total > 0::numeric THEN
               round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0::numeric)) / col.cartera_total, 6)
           ELSE NULL::numeric
       END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_historica IS
    'Mora Global por nombre vigente en cada periodo (renombres separados).';
