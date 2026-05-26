-- =========================================================================
-- V083: Mora Global usa el BALANCE (cta_a4_1/2/3) en lugar de raw.colocaciones
--
-- Bug raiz: raw.colocaciones_observacion (importado del archivo SBS de
-- "Estructura de Cartera por Tipo de Credito") NO incluye Creditos de
-- Consumo ni Hipotecarios para ciertas entidades (vienen en archivos
-- separados de SBS). Para Mibanco Apr 2020:
--   Raw colocaciones total: 10,186,916 (solo corporativo + MYPE + hipotecario)
--   Balance cta_a4_1+2+3:   10,828,700 (todo, incluye consumo 641,784)
--
-- El Excel oficial usa el archivo Colocaciones detallado (TD_Colocac) y
-- suma TODOS los productos incluyendo R261 Consumo + R262 Hipotecario.
-- Como el Balance ya tiene la suma completa (todas las cuentas estan
-- separadas como A4.1 Vigente / A4.2 Refinanciado / A4.3 Atrasado),
-- usar el balance es exact match al Excel y NO depende de imports parciales.
--
-- Validacion Mibanco Apr 2020:
--   MG = (544,759 + 104,796 + 363,514) / 10,828,700 = 9.36% (Excel exact)
-- =========================================================================

DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;


-- ============ CARTERA DEL BALANCE (CANONICO) ============
CREATE OR REPLACE VIEW marts.v_cartera_balance_entidad AS
SELECT periodo,
       dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
       SUM(COALESCE(cta_a4_1, 0)) AS cartera_vigente,
       SUM(COALESCE(cta_a4_2, 0)) AS cartera_refin,
       SUM(COALESCE(cta_a4_3, 0)) AS cartera_atrasada,
       SUM(COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0)) AS cartera_bruta
FROM marts.v_eeff_balance_ancho
WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

COMMENT ON VIEW marts.v_cartera_balance_entidad IS
    'Cartera por entidad canonica desde el balance (cta_a4_1 + a4_2 + a4_3). '
    'Incluye TODOS los productos (corporativo, MYPE, consumo, hipotecario) '
    'a diferencia de raw.colocaciones_observacion que puede tener splits parciales.';


-- ============ CARTERA DEL BALANCE (HISTORICA) ============
CREATE OR REPLACE VIEW marts.v_cartera_balance_historica AS
SELECT periodo,
       dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
       SUM(COALESCE(cta_a4_1, 0)) AS cartera_vigente,
       SUM(COALESCE(cta_a4_2, 0)) AS cartera_refin,
       SUM(COALESCE(cta_a4_3, 0)) AS cartera_atrasada,
       SUM(COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0)) AS cartera_bruta
FROM marts.v_eeff_balance_ancho
WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo);


-- ============ CASTIGOS 12m: AHORA USA EL BALANCE COMO UNIVERSO ============
DROP VIEW IF EXISTS marts.v_castigos_12m_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_castigos_12m_historica CASCADE;

CREATE OR REPLACE VIEW marts.v_castigos_12m_entidad AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(c.saldo_castigos), 0::numeric) AS castigos_12m
FROM marts.v_cartera_balance_entidad u
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

CREATE OR REPLACE VIEW marts.v_castigos_12m_historica AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(c.saldo_castigos), 0::numeric) AS castigos_12m
FROM marts.v_cartera_balance_historica u
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


-- ============ VENTA CARTERA 12m: REENCAUZAR UNIVERSO ============
-- v_venta_cartera_12m sigue usando v_venta_cartera_mes/v_a44 (eso esta bien).
-- Solo necesitamos que el universo de v_venta_cartera_12m incluya todos los
-- periodos del balance. Recreamos con cartera_balance como universo.
DROP VIEW IF EXISTS marts.v_venta_cartera_12m CASCADE;
DROP VIEW IF EXISTS marts.v_venta_cartera_12m_historica CASCADE;

CREATE OR REPLACE VIEW marts.v_venta_cartera_12m AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(v.venta_cartera_mes), 0::numeric) AS venta_cartera_12m
FROM marts.v_cartera_balance_entidad u
LEFT JOIN marts.v_venta_cartera_mes v
    ON v.nomb_correg = u.nomb_correg
    AND v.periodo >= CASE
        WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
        ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
    END
    AND v.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;

CREATE OR REPLACE VIEW marts.v_venta_cartera_12m_historica AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(v.venta_cartera_mes), 0::numeric) AS venta_cartera_12m
FROM marts.v_cartera_balance_historica u
LEFT JOIN marts.v_venta_cartera_mes_historica v
    ON v.nomb_correg = u.nomb_correg
    AND v.periodo >= CASE
        WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
        ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
    END
    AND v.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;


-- ============ MORA GLOBAL (CANONICO) ============
CREATE OR REPLACE VIEW marts.v_mora_global_por_entidad AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0) + COALESCE(vc.venta_cartera_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global_vc
FROM marts.v_cartera_balance_entidad col
LEFT JOIN marts.v_castigos_12m_entidad cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_por_entidad IS
    'MG = (Atrasada+Refin+Castigos12m)/Cartera Bruta usando el BALANCE como '
    'fuente. Incluye consumo + hipotecario + corporativo + MYPE (a diferencia '
    'de raw.colocaciones que puede tener splits parciales). Match exacto Excel.';


-- ============ MORA GLOBAL (HISTORICA) ============
CREATE OR REPLACE VIEW marts.v_mora_global_historica AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0) + COALESCE(vc.venta_cartera_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global_vc
FROM marts.v_cartera_balance_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m_historica vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;
