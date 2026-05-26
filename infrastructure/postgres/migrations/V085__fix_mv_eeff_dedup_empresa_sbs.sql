-- =========================================================================
-- V085: Fix duplicados en mv_eeff_balance_ancho y mv_eeff_resultados_ancho.
--
-- Bug: las MVs agrupaban por (periodo, fecha_cierre, nomb_correg, empresa_sbs,
-- tipo_entidad, microfinanciera, nacional, moneda). Cuando una misma entidad
-- tenia filas con empresa_sbs NULL (vienen del scrape monthly) y otras con
-- valor (legacy o base), generaban 2 filas distintas en la MV con la misma
-- (periodo, nomb_correg, moneda) — y el UNIQUE INDEX explotaba.
--
-- 11,521 combinaciones afectadas (~30% de los periodos x entidad x moneda).
--
-- Fix: GROUP BY solo por (periodo, fecha_cierre, nomb_correg, moneda).
-- Los demas campos dimensionales (empresa_sbs, tipo_entidad, microfinanciera,
-- nacional) se obtienen con MAX() — siempre toman el valor no-NULL si existe.
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_balance_ancho CASCADE;
DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_resultados_ancho CASCADE;

-- Re-crear con GROUP BY corregido. Mantengo TODAS las columnas cta_* del
-- archivo original V009 (es auto-generado pero la lista es estable).
-- Las dimensionales pasan a MAX() agregado.

CREATE MATERIALIZED VIEW marts.mv_eeff_balance_ancho AS
SELECT
    periodo,
    MAX(fecha_cierre)                AS fecha_cierre,
    nomb_correg,
    MAX(empresa_sbs)                 AS empresa_sbs,
    MAX(tipo_entidad)                AS tipo_entidad,
    MAX(microfinanciera)             AS microfinanciera,
    MAX(nacional)                    AS nacional,
    moneda,
    MAX(CASE WHEN cuenta_codigo = 'A1'      THEN valor END) AS cta_a1,
    MAX(CASE WHEN cuenta_codigo = 'A1.1'    THEN valor END) AS cta_a1_1,
    MAX(CASE WHEN cuenta_codigo = 'A1.2'    THEN valor END) AS cta_a1_2,
    MAX(CASE WHEN cuenta_codigo = 'A1.3'    THEN valor END) AS cta_a1_3,
    MAX(CASE WHEN cuenta_codigo = 'A1.4'    THEN valor END) AS cta_a1_4,
    MAX(CASE WHEN cuenta_codigo = 'A2'      THEN valor END) AS cta_a2,
    MAX(CASE WHEN cuenta_codigo = 'A3'      THEN valor END) AS cta_a3,
    MAX(CASE WHEN cuenta_codigo = 'A3.1'    THEN valor END) AS cta_a3_1,
    MAX(CASE WHEN cuenta_codigo = 'A3.2'    THEN valor END) AS cta_a3_2,
    MAX(CASE WHEN cuenta_codigo = 'A3.3'    THEN valor END) AS cta_a3_3,
    MAX(CASE WHEN cuenta_codigo = 'A3.4'    THEN valor END) AS cta_a3_4,
    MAX(CASE WHEN cuenta_codigo = 'A3.5'    THEN valor END) AS cta_a3_5,
    MAX(CASE WHEN cuenta_codigo = 'A3.6'    THEN valor END) AS cta_a3_6,
    MAX(CASE WHEN cuenta_codigo = 'A3.7'    THEN valor END) AS cta_a3_7,
    MAX(CASE WHEN cuenta_codigo = 'A3.8'    THEN valor END) AS cta_a3_8,
    MAX(CASE WHEN cuenta_codigo = 'A3.9'    THEN valor END) AS cta_a3_9,
    MAX(CASE WHEN cuenta_codigo = 'A4'      THEN valor END) AS cta_a4,
    MAX(CASE WHEN cuenta_codigo = 'A4.1'    THEN valor END) AS cta_a4_1,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.1'  THEN valor END) AS cta_a4_1_1,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.2'  THEN valor END) AS cta_a4_1_2,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.3'  THEN valor END) AS cta_a4_1_3,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.4'  THEN valor END) AS cta_a4_1_4,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.5'  THEN valor END) AS cta_a4_1_5,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.6'  THEN valor END) AS cta_a4_1_6,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.7'  THEN valor END) AS cta_a4_1_7,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.8'  THEN valor END) AS cta_a4_1_8,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.9'  THEN valor END) AS cta_a4_1_9,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.10' THEN valor END) AS cta_a4_1_10,
    MAX(CASE WHEN cuenta_codigo = 'A4.2'    THEN valor END) AS cta_a4_2,
    MAX(CASE WHEN cuenta_codigo = 'A4.3'    THEN valor END) AS cta_a4_3,
    MAX(CASE WHEN cuenta_codigo = 'A4.4'    THEN valor END) AS cta_a4_4,
    MAX(CASE WHEN cuenta_codigo = 'A4.5'    THEN valor END) AS cta_a4_5,
    MAX(CASE WHEN cuenta_codigo = 'A5'      THEN valor END) AS cta_a5,
    MAX(CASE WHEN cuenta_codigo = 'A6'      THEN valor END) AS cta_a6,
    MAX(CASE WHEN cuenta_codigo = 'A7'      THEN valor END) AS cta_a7,
    MAX(CASE WHEN cuenta_codigo = 'A8'      THEN valor END) AS cta_a8,
    MAX(CASE WHEN cuenta_codigo = 'A9'      THEN valor END) AS cta_a9,
    MAX(CASE WHEN cuenta_codigo = 'A10'     THEN valor END) AS cta_a10,
    MAX(CASE WHEN cuenta_codigo = 'B1'      THEN valor END) AS cta_b1,
    MAX(CASE WHEN cuenta_codigo = 'B1.1'    THEN valor END) AS cta_b1_1,
    MAX(CASE WHEN cuenta_codigo = 'B1.2'    THEN valor END) AS cta_b1_2,
    MAX(CASE WHEN cuenta_codigo = 'B1.3'    THEN valor END) AS cta_b1_3,
    MAX(CASE WHEN cuenta_codigo = 'B1.4'    THEN valor END) AS cta_b1_4,
    MAX(CASE WHEN cuenta_codigo = 'B1.5'    THEN valor END) AS cta_b1_5,
    MAX(CASE WHEN cuenta_codigo = 'B1.6'    THEN valor END) AS cta_b1_6,
    MAX(CASE WHEN cuenta_codigo = 'B2'      THEN valor END) AS cta_b2,
    MAX(CASE WHEN cuenta_codigo = 'B3'      THEN valor END) AS cta_b3,
    MAX(CASE WHEN cuenta_codigo = 'B4'      THEN valor END) AS cta_b4,
    MAX(CASE WHEN cuenta_codigo = 'B5'      THEN valor END) AS cta_b5,
    MAX(CASE WHEN cuenta_codigo = 'B6'      THEN valor END) AS cta_b6,
    MAX(CASE WHEN cuenta_codigo = 'B7'      THEN valor END) AS cta_b7,
    MAX(CASE WHEN cuenta_codigo = 'B8'      THEN valor END) AS cta_b8,
    MAX(CASE WHEN cuenta_codigo = 'B9'      THEN valor END) AS cta_b9,
    MAX(CASE WHEN cuenta_codigo = 'B10'     THEN valor END) AS cta_b10,
    MAX(CASE WHEN cuenta_codigo = 'C1'      THEN valor END) AS cta_c1,
    MAX(CASE WHEN cuenta_codigo = 'C2'      THEN valor END) AS cta_c2,
    MAX(CASE WHEN cuenta_codigo = 'C3'      THEN valor END) AS cta_c3,
    MAX(CASE WHEN cuenta_codigo = 'C4'      THEN valor END) AS cta_c4,
    MAX(CASE WHEN cuenta_codigo = 'C5'      THEN valor END) AS cta_c5,
    MAX(CASE WHEN cuenta_codigo = 'C6'      THEN valor END) AS cta_c6,
    MAX(CASE WHEN cuenta_codigo = 'C7'      THEN valor END) AS cta_c7,
    MAX(CASE WHEN cuenta_codigo = 'C8'      THEN valor END) AS cta_c8,
    MAX(CASE WHEN cuenta_codigo = 'A'       THEN valor END) AS cta_a,
    MAX(CASE WHEN cuenta_codigo = 'B'       THEN valor END) AS cta_b,
    MAX(CASE WHEN cuenta_codigo = 'C'       THEN valor END) AS cta_c
FROM raw.eeff_observacion
WHERE tipo_estado = 'balance'
GROUP BY periodo, nomb_correg, moneda;

CREATE UNIQUE INDEX uq_mv_eeff_balance_ancho
    ON marts.mv_eeff_balance_ancho (periodo, nomb_correg, moneda);

CREATE INDEX idx_mv_eeff_balance_ancho_periodo
    ON marts.mv_eeff_balance_ancho (periodo);

CREATE INDEX idx_mv_eeff_balance_ancho_nomb
    ON marts.mv_eeff_balance_ancho (nomb_correg);


-- =========================================================================
-- mv_eeff_resultados_ancho — mismo fix
-- =========================================================================
CREATE MATERIALIZED VIEW marts.mv_eeff_resultados_ancho AS
SELECT
    periodo,
    MAX(fecha_cierre)                AS fecha_cierre,
    nomb_correg,
    MAX(empresa_sbs)                 AS empresa_sbs,
    MAX(tipo_entidad)                AS tipo_entidad,
    MAX(microfinanciera)             AS microfinanciera,
    MAX(nacional)                    AS nacional,
    moneda,
    MAX(CASE WHEN cuenta_codigo = '1'      THEN valor END) AS cta_1,
    MAX(CASE WHEN cuenta_codigo = '1.1'    THEN valor END) AS cta_1_1,
    MAX(CASE WHEN cuenta_codigo = '1.2'    THEN valor END) AS cta_1_2,
    MAX(CASE WHEN cuenta_codigo = '1.3'    THEN valor END) AS cta_1_3,
    MAX(CASE WHEN cuenta_codigo = '1.4'    THEN valor END) AS cta_1_4,
    MAX(CASE WHEN cuenta_codigo = '1.5'    THEN valor END) AS cta_1_5,
    MAX(CASE WHEN cuenta_codigo = '1.6'    THEN valor END) AS cta_1_6,
    MAX(CASE WHEN cuenta_codigo = '1.7'    THEN valor END) AS cta_1_7,
    MAX(CASE WHEN cuenta_codigo = '1.8'    THEN valor END) AS cta_1_8,
    MAX(CASE WHEN cuenta_codigo = '1.9'    THEN valor END) AS cta_1_9,
    MAX(CASE WHEN cuenta_codigo = '1.10'   THEN valor END) AS cta_1_10,
    MAX(CASE WHEN cuenta_codigo = '2'      THEN valor END) AS cta_2,
    MAX(CASE WHEN cuenta_codigo = '2.1'    THEN valor END) AS cta_2_1,
    MAX(CASE WHEN cuenta_codigo = '2.2'    THEN valor END) AS cta_2_2,
    MAX(CASE WHEN cuenta_codigo = '2.3'    THEN valor END) AS cta_2_3,
    MAX(CASE WHEN cuenta_codigo = '2.4'    THEN valor END) AS cta_2_4,
    MAX(CASE WHEN cuenta_codigo = '2.5'    THEN valor END) AS cta_2_5,
    MAX(CASE WHEN cuenta_codigo = '2.6'    THEN valor END) AS cta_2_6,
    MAX(CASE WHEN cuenta_codigo = '2.7'    THEN valor END) AS cta_2_7,
    MAX(CASE WHEN cuenta_codigo = '2.8'    THEN valor END) AS cta_2_8,
    MAX(CASE WHEN cuenta_codigo = '2.9'    THEN valor END) AS cta_2_9,
    MAX(CASE WHEN cuenta_codigo = '2.10'   THEN valor END) AS cta_2_10,
    MAX(CASE WHEN cuenta_codigo = '2.11'   THEN valor END) AS cta_2_11,
    MAX(CASE WHEN cuenta_codigo = '2.12'   THEN valor END) AS cta_2_12,
    MAX(CASE WHEN cuenta_codigo = '2.13'   THEN valor END) AS cta_2_13,
    MAX(CASE WHEN cuenta_codigo = '3'      THEN valor END) AS cta_3,
    MAX(CASE WHEN cuenta_codigo = '4'      THEN valor END) AS cta_4,
    MAX(CASE WHEN cuenta_codigo = '4.1'    THEN valor END) AS cta_4_1,
    MAX(CASE WHEN cuenta_codigo = '4.2'    THEN valor END) AS cta_4_2,
    MAX(CASE WHEN cuenta_codigo = '5'      THEN valor END) AS cta_5,
    MAX(CASE WHEN cuenta_codigo = '6'      THEN valor END) AS cta_6,
    MAX(CASE WHEN cuenta_codigo = '6.1'    THEN valor END) AS cta_6_1,
    MAX(CASE WHEN cuenta_codigo = '6.2'    THEN valor END) AS cta_6_2,
    MAX(CASE WHEN cuenta_codigo = '6.3'    THEN valor END) AS cta_6_3,
    MAX(CASE WHEN cuenta_codigo = '6.4'    THEN valor END) AS cta_6_4,
    MAX(CASE WHEN cuenta_codigo = '7'      THEN valor END) AS cta_7,
    MAX(CASE WHEN cuenta_codigo = '7.1'    THEN valor END) AS cta_7_1,
    MAX(CASE WHEN cuenta_codigo = '7.2'    THEN valor END) AS cta_7_2,
    MAX(CASE WHEN cuenta_codigo = '7.3'    THEN valor END) AS cta_7_3,
    MAX(CASE WHEN cuenta_codigo = '7.4'    THEN valor END) AS cta_7_4,
    MAX(CASE WHEN cuenta_codigo = '8'      THEN valor END) AS cta_8,
    MAX(CASE WHEN cuenta_codigo = '9'      THEN valor END) AS cta_9,
    MAX(CASE WHEN cuenta_codigo = '10'     THEN valor END) AS cta_10,
    MAX(CASE WHEN cuenta_codigo = '10.1'   THEN valor END) AS cta_10_1,
    MAX(CASE WHEN cuenta_codigo = '10.2'   THEN valor END) AS cta_10_2,
    MAX(CASE WHEN cuenta_codigo = '10.3'   THEN valor END) AS cta_10_3,
    MAX(CASE WHEN cuenta_codigo = '10.4'   THEN valor END) AS cta_10_4,
    MAX(CASE WHEN cuenta_codigo = '11'     THEN valor END) AS cta_11,
    MAX(CASE WHEN cuenta_codigo = '12'     THEN valor END) AS cta_12,
    MAX(CASE WHEN cuenta_codigo = '12.1'   THEN valor END) AS cta_12_1,
    MAX(CASE WHEN cuenta_codigo = '12.2'   THEN valor END) AS cta_12_2,
    MAX(CASE WHEN cuenta_codigo = '12.3'   THEN valor END) AS cta_12_3,
    MAX(CASE WHEN cuenta_codigo = '12.4'   THEN valor END) AS cta_12_4,
    MAX(CASE WHEN cuenta_codigo = '12.5'   THEN valor END) AS cta_12_5,
    MAX(CASE WHEN cuenta_codigo = '12.6'   THEN valor END) AS cta_12_6,
    MAX(CASE WHEN cuenta_codigo = '12.7'   THEN valor END) AS cta_12_7,
    MAX(CASE WHEN cuenta_codigo = '12.8'   THEN valor END) AS cta_12_8,
    MAX(CASE WHEN cuenta_codigo = '13'     THEN valor END) AS cta_13,
    MAX(CASE WHEN cuenta_codigo = '13.1'   THEN valor END) AS cta_13_1,
    MAX(CASE WHEN cuenta_codigo = '13.2'   THEN valor END) AS cta_13_2,
    MAX(CASE WHEN cuenta_codigo = '13.3'   THEN valor END) AS cta_13_3,
    MAX(CASE WHEN cuenta_codigo = '14'     THEN valor END) AS cta_14,
    MAX(CASE WHEN cuenta_codigo = '15'     THEN valor END) AS cta_15,
    MAX(CASE WHEN cuenta_codigo = '16'     THEN valor END) AS cta_16,
    MAX(CASE WHEN cuenta_codigo = '17'     THEN valor END) AS cta_17
FROM raw.eeff_observacion
WHERE tipo_estado = 'resultados'
GROUP BY periodo, nomb_correg, moneda;

CREATE UNIQUE INDEX uq_mv_eeff_resultados_ancho
    ON marts.mv_eeff_resultados_ancho (periodo, nomb_correg, moneda);

CREATE INDEX idx_mv_eeff_resultados_ancho_periodo
    ON marts.mv_eeff_resultados_ancho (periodo);

CREATE INDEX idx_mv_eeff_resultados_ancho_nomb
    ON marts.mv_eeff_resultados_ancho (nomb_correg);
