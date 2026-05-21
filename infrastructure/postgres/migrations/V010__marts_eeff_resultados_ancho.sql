-- =========================================================================
-- AUTO-GENERATED por data-platform/scripts/generate_marts_sql.py
-- NO editar a mano. Si las cuentas cambian, regenerar y commitear de nuevo.
--
-- Vista materializada wide-format para EEFF tipo 'resultados'.
-- 1 fila por (periodo, nomb_correg, moneda).
-- 1 columna por cuenta canonica (cta_<codigo_sanitizado>).
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_resultados_ancho;

CREATE MATERIALIZED VIEW marts.mv_eeff_resultados_ancho AS
SELECT
    periodo,
    fecha_cierre,
    nomb_correg,
    empresa_sbs,
    tipo_entidad,
    microfinanciera,
    nacional,
    moneda,
    MAX(CASE WHEN cuenta_codigo = '1' THEN valor END) AS cta_1  -- INGRESOS FINANCIEROS,
    MAX(CASE WHEN cuenta_codigo = '1.1' THEN valor END) AS cta_1_1  -- Disponibles,
    MAX(CASE WHEN cuenta_codigo = '1.2' THEN valor END) AS cta_1_2  -- Fondos Interbancarios,
    MAX(CASE WHEN cuenta_codigo = '1.3' THEN valor END) AS cta_1_3  -- Inversiones,
    MAX(CASE WHEN cuenta_codigo = '1.4' THEN valor END) AS cta_1_4  -- Créditos Directos,
    MAX(CASE WHEN cuenta_codigo = '1.5' THEN valor END) AS cta_1_5  -- Ganancias por Valorización de Inversiones,
    MAX(CASE WHEN cuenta_codigo = '1.6' THEN valor END) AS cta_1_6  -- Ganancias por Inversiones en Subsidiarias, Asociadas y Negocios Conjuntos,
    MAX(CASE WHEN cuenta_codigo = '1.7' THEN valor END) AS cta_1_7  -- Diferencia de Cambio,
    MAX(CASE WHEN cuenta_codigo = '1.8' THEN valor END) AS cta_1_8  -- Ganancias en Productos Financieros Derivados,
    MAX(CASE WHEN cuenta_codigo = '1.9' THEN valor END) AS cta_1_9  -- Reajuste por Indexación,
    MAX(CASE WHEN cuenta_codigo = '1.10' THEN valor END) AS cta_1_10  -- Otros,
    MAX(CASE WHEN cuenta_codigo = '2' THEN valor END) AS cta_2  -- GASTOS FINANCIEROS,
    MAX(CASE WHEN cuenta_codigo = '2.1' THEN valor END) AS cta_2_1  -- Obligaciones con el Público,
    MAX(CASE WHEN cuenta_codigo = '2.2' THEN valor END) AS cta_2_2  -- Depósitos del Sistema Financiero y Organismos Financieros Internacionales,
    MAX(CASE WHEN cuenta_codigo = '2.3' THEN valor END) AS cta_2_3  -- Fondos Interbancarios,
    MAX(CASE WHEN cuenta_codigo = '2.4' THEN valor END) AS cta_2_4  -- Adeudos y Obligaciones Financieras,
    MAX(CASE WHEN cuenta_codigo = '2.5' THEN valor END) AS cta_2_5  -- Obligaciones en Circulación no Subordinadas,
    MAX(CASE WHEN cuenta_codigo = '2.6' THEN valor END) AS cta_2_6  -- Obligaciones en Circulación Subordinadas,
    MAX(CASE WHEN cuenta_codigo = '2.7' THEN valor END) AS cta_2_7  -- Pérdida por Valorización de Inversiones,
    MAX(CASE WHEN cuenta_codigo = '2.8' THEN valor END) AS cta_2_8  -- Pérdidas por Inversiones en Subsidiarias, Asociadas y Negocios Conjuntos,
    MAX(CASE WHEN cuenta_codigo = '2.9' THEN valor END) AS cta_2_9  -- Primas al Fondo de Seguro de Depósitos,
    MAX(CASE WHEN cuenta_codigo = '2.10' THEN valor END) AS cta_2_10  -- Diferencia de Cambio,
    MAX(CASE WHEN cuenta_codigo = '2.11' THEN valor END) AS cta_2_11  -- Pérdidas en Productos Financieros Derivados,
    MAX(CASE WHEN cuenta_codigo = '2.12' THEN valor END) AS cta_2_12  -- Reajuste por Indexación,
    MAX(CASE WHEN cuenta_codigo = '2.13' THEN valor END) AS cta_2_13  -- Otros,
    MAX(CASE WHEN cuenta_codigo = '3' THEN valor END) AS cta_3  -- MARGEN FINANCIERO BRUTO,
    MAX(CASE WHEN cuenta_codigo = '4' THEN valor END) AS cta_4  -- PROVISIONES PARA INCOBRABILIDAD DE CRÉDITOS,
    MAX(CASE WHEN cuenta_codigo = '4.1' THEN valor END) AS cta_4_1  -- Provisiones para Desvalorización de Inversiones,
    MAX(CASE WHEN cuenta_codigo = '4.2' THEN valor END) AS cta_4_2  -- Provisiones para Incobrabilidad de Créditos,
    MAX(CASE WHEN cuenta_codigo = '5' THEN valor END) AS cta_5  -- MARGEN FINANCIERO NETO,
    MAX(CASE WHEN cuenta_codigo = '6' THEN valor END) AS cta_6  -- INGRESOS POR SERVICIOS FINANCIEROS,
    MAX(CASE WHEN cuenta_codigo = '6.1' THEN valor END) AS cta_6_1  -- Cuentas por Cobrar,
    MAX(CASE WHEN cuenta_codigo = '6.2' THEN valor END) AS cta_6_2  -- Créditos Indirectos,
    MAX(CASE WHEN cuenta_codigo = '6.3' THEN valor END) AS cta_6_3  -- Fideicomisos y Comisiones de Confianza,
    MAX(CASE WHEN cuenta_codigo = '6.4' THEN valor END) AS cta_6_4  -- Ingresos Diversos,
    MAX(CASE WHEN cuenta_codigo = '7' THEN valor END) AS cta_7  -- GASTOS POR SERVICIOS FINANCIEROS,
    MAX(CASE WHEN cuenta_codigo = '7.1' THEN valor END) AS cta_7_1  -- Cuentas por Pagar,
    MAX(CASE WHEN cuenta_codigo = '7.2' THEN valor END) AS cta_7_2  -- Créditos Indirectos,
    MAX(CASE WHEN cuenta_codigo = '7.3' THEN valor END) AS cta_7_3  -- Fideicomisos y Comisiones de Confianza,
    MAX(CASE WHEN cuenta_codigo = '7.4' THEN valor END) AS cta_7_4  -- Gastos Diversos,
    MAX(CASE WHEN cuenta_codigo = '8' THEN valor END) AS cta_8  -- GANANCIA (PÉRDIDA) POR VENTA DE CARTERA,
    MAX(CASE WHEN cuenta_codigo = '9' THEN valor END) AS cta_9  -- MARGEN OPERACIONAL,
    MAX(CASE WHEN cuenta_codigo = '10' THEN valor END) AS cta_10  -- GASTOS ADMINISTRATIVOS,
    MAX(CASE WHEN cuenta_codigo = '10.1' THEN valor END) AS cta_10_1  -- Personal,
    MAX(CASE WHEN cuenta_codigo = '10.2' THEN valor END) AS cta_10_2  -- Directorio,
    MAX(CASE WHEN cuenta_codigo = '10.3' THEN valor END) AS cta_10_3  -- Servicios Recibidos de Terceros,
    MAX(CASE WHEN cuenta_codigo = '10.4' THEN valor END) AS cta_10_4  -- Impuestos y Contribuciones,
    MAX(CASE WHEN cuenta_codigo = '11' THEN valor END) AS cta_11  -- MARGEN OPERACIONAL NETO,
    MAX(CASE WHEN cuenta_codigo = '12' THEN valor END) AS cta_12  -- PROVISIONES, DEPRECIACIÓN Y AMORTIZACIÓN,
    MAX(CASE WHEN cuenta_codigo = '12.1' THEN valor END) AS cta_12_1  -- Provisiones para Contingencias y Otras,
    MAX(CASE WHEN cuenta_codigo = '12.2' THEN valor END) AS cta_12_2  -- Provisiones para Créditos Indirectos,
    MAX(CASE WHEN cuenta_codigo = '12.3' THEN valor END) AS cta_12_3  -- Provisiones por Pérdida por Deterioro de Inversiones,
    MAX(CASE WHEN cuenta_codigo = '12.4' THEN valor END) AS cta_12_4  -- Provisiones para Incobrabilidad de Cuentas por Cobrar,
    MAX(CASE WHEN cuenta_codigo = '12.5' THEN valor END) AS cta_12_5  -- Provisiones para Bienes Realizables, Recibidos en Pago y Adjudicados,
    MAX(CASE WHEN cuenta_codigo = '12.6' THEN valor END) AS cta_12_6  -- Otras Provisiones,
    MAX(CASE WHEN cuenta_codigo = '12.7' THEN valor END) AS cta_12_7  -- Depreciación,
    MAX(CASE WHEN cuenta_codigo = '12.8' THEN valor END) AS cta_12_8  -- Amortización,
    MAX(CASE WHEN cuenta_codigo = '13' THEN valor END) AS cta_13  -- OTROS INGRESOS Y GASTOS,
    MAX(CASE WHEN cuenta_codigo = '13.1' THEN valor END) AS cta_13_1  -- Ingresos (Gastos) por Recuperación de Créditos,
    MAX(CASE WHEN cuenta_codigo = '13.2' THEN valor END) AS cta_13_2  -- Ingresos (Gastos) Extraordinarios,
    MAX(CASE WHEN cuenta_codigo = '13.3' THEN valor END) AS cta_13_3  -- Ingresos (Gastos) de Ejercicios Anteriores,
    MAX(CASE WHEN cuenta_codigo = '14' THEN valor END) AS cta_14  -- UTILIDAD (PÉRDIDA) ANTES DE PARTICIPACIONES E  IMPUESTO A LA RENTA,
    MAX(CASE WHEN cuenta_codigo = '15' THEN valor END) AS cta_15  -- PARTICIPACIÓN DE TRABAJADORES,
    MAX(CASE WHEN cuenta_codigo = '16' THEN valor END) AS cta_16  -- IMPUESTO A LA RENTA,
    MAX(CASE WHEN cuenta_codigo = '17' THEN valor END) AS cta_17  -- UTILIDAD (PÉRDIDA) NETA
FROM raw.eeff_observacion
WHERE tipo_estado = 'resultados'
GROUP BY periodo, fecha_cierre, nomb_correg, empresa_sbs,
         tipo_entidad, microfinanciera, nacional, moneda;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_eeff_resultados_ancho
    ON marts.mv_eeff_resultados_ancho (periodo, nomb_correg, moneda);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_resultados_ancho_periodo
    ON marts.mv_eeff_resultados_ancho (periodo);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_resultados_ancho_entidad
    ON marts.mv_eeff_resultados_ancho (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_resultados_ancho_tipo
    ON marts.mv_eeff_resultados_ancho (tipo_entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_eeff_resultados_ancho IS
    'Pivot wide-format de EEFF resultados. Auto-generado desde seeds.';
