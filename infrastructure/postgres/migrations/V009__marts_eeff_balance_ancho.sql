-- =========================================================================
-- AUTO-GENERATED por data-platform/scripts/generate_marts_sql.py
-- NO editar a mano. Si las cuentas cambian, regenerar y commitear de nuevo.
--
-- Vista materializada wide-format para EEFF tipo 'balance'.
-- 1 fila por (periodo, nomb_correg, moneda).
-- 1 columna por cuenta canonica (cta_<codigo_sanitizado>).
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_balance_ancho;

CREATE MATERIALIZED VIEW marts.mv_eeff_balance_ancho AS
SELECT
    periodo,
    fecha_cierre,
    nomb_correg,
    empresa_sbs,
    tipo_entidad,
    microfinanciera,
    nacional,
    moneda,
    MAX(CASE WHEN cuenta_codigo = 'A1' THEN valor END) AS cta_a1  -- DISPONIBLE,
    MAX(CASE WHEN cuenta_codigo = 'A1.1' THEN valor END) AS cta_a1_1  -- Caja,
    MAX(CASE WHEN cuenta_codigo = 'A1.2' THEN valor END) AS cta_a1_2  -- Bancos y Corresponsales,
    MAX(CASE WHEN cuenta_codigo = 'A1.3' THEN valor END) AS cta_a1_3  -- Canje,
    MAX(CASE WHEN cuenta_codigo = 'A1.4' THEN valor END) AS cta_a1_4  -- Otros,
    MAX(CASE WHEN cuenta_codigo = 'A2' THEN valor END) AS cta_a2  -- FONDOS INTERBANCARIOS,
    MAX(CASE WHEN cuenta_codigo = 'A3' THEN valor END) AS cta_a3  -- INVERSIONES NETAS DE PROVISIONES E INGRESOS NO DEVENGADOS,
    MAX(CASE WHEN cuenta_codigo = 'A3.1' THEN valor END) AS cta_a3_1  -- Negociables para Intermediación Financiera,
    MAX(CASE WHEN cuenta_codigo = 'A3.2' THEN valor END) AS cta_a3_2  -- Inversiones a Valor Razonable con Cambios en Resultados,
    MAX(CASE WHEN cuenta_codigo = 'A3.3' THEN valor END) AS cta_a3_3  -- Inversiones Disponibles para la Venta,
    MAX(CASE WHEN cuenta_codigo = 'A3.4' THEN valor END) AS cta_a3_4  -- Inversiones a Vencimiento,
    MAX(CASE WHEN cuenta_codigo = 'A3.5' THEN valor END) AS cta_a3_5  -- Permanentes,
    MAX(CASE WHEN cuenta_codigo = 'A3.6' THEN valor END) AS cta_a3_6  -- Inversiones en subsidiarias y asociadas,
    MAX(CASE WHEN cuenta_codigo = 'A3.7' THEN valor END) AS cta_a3_7  -- Inversiones en Commodities,
    MAX(CASE WHEN cuenta_codigo = 'A3.8' THEN valor END) AS cta_a3_8  -- Provisiones,
    MAX(CASE WHEN cuenta_codigo = 'A3.9' THEN valor END) AS cta_a3_9  -- Ingresos por Compraventa de Valores no Devengados,
    MAX(CASE WHEN cuenta_codigo = 'A4' THEN valor END) AS cta_a4  -- CRÉDITOS NETOS DE PROVISIONES E INGRESOS NO DEVENGADOS,
    MAX(CASE WHEN cuenta_codigo = 'A4.1' THEN valor END) AS cta_a4_1  -- Vigentes,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.1' THEN valor END) AS cta_a4_1_1  -- Cuentas Corrientes,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.2' THEN valor END) AS cta_a4_1_2  -- Tarjetas de Crédito,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.3' THEN valor END) AS cta_a4_1_3  -- Descuentos,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.4' THEN valor END) AS cta_a4_1_4  -- Factoring,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.5' THEN valor END) AS cta_a4_1_5  -- Préstamos,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.6' THEN valor END) AS cta_a4_1_6  -- Arrendamiento,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.7' THEN valor END) AS cta_a4_1_7  -- Hipotecarios,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.8' THEN valor END) AS cta_a4_1_8  -- Comercio Exterior,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.9' THEN valor END) AS cta_a4_1_9  -- Créditos por Liquidar,
    MAX(CASE WHEN cuenta_codigo = 'A4.1.10' THEN valor END) AS cta_a4_1_10  -- Otros,
    MAX(CASE WHEN cuenta_codigo = 'A4.2' THEN valor END) AS cta_a4_2  -- Refinanciados y Reestructurados,
    MAX(CASE WHEN cuenta_codigo = 'A4.3' THEN valor END) AS cta_a4_3  -- Atrasados,
    MAX(CASE WHEN cuenta_codigo = 'A4.3.1' THEN valor END) AS cta_a4_3_1  -- Vencidos,
    MAX(CASE WHEN cuenta_codigo = 'A4.3.2' THEN valor END) AS cta_a4_3_2  -- En Cobranza Judicial,
    MAX(CASE WHEN cuenta_codigo = 'A4.4' THEN valor END) AS cta_a4_4  -- Provisiones,
    MAX(CASE WHEN cuenta_codigo = 'A4.5' THEN valor END) AS cta_a4_5  -- Intereses y Comisiones  no Devengados,
    MAX(CASE WHEN cuenta_codigo = 'A5' THEN valor END) AS cta_a5  -- CUENTAS POR COBRAR NETAS DE PROVISIONES,
    MAX(CASE WHEN cuenta_codigo = 'A6' THEN valor END) AS cta_a6  -- RENDIMIENTOS DEVENGADOS POR COBRAR,
    MAX(CASE WHEN cuenta_codigo = 'A6.1' THEN valor END) AS cta_a6_1  -- Disponible,
    MAX(CASE WHEN cuenta_codigo = 'A6.2' THEN valor END) AS cta_a6_2  -- Fondos Interbancarios,
    MAX(CASE WHEN cuenta_codigo = 'A6.3' THEN valor END) AS cta_a6_3  -- Inversiones,
    MAX(CASE WHEN cuenta_codigo = 'A6.4' THEN valor END) AS cta_a6_4  -- Créditos,
    MAX(CASE WHEN cuenta_codigo = 'A6.5' THEN valor END) AS cta_a6_5  -- Cuentas por Cobrar,
    MAX(CASE WHEN cuenta_codigo = 'A7' THEN valor END) AS cta_a7  -- BIENES REALIZABLES, RECIBIDOS EN PAGO, ADJUDICADOS Y FUERA DE USO NETOS,
    MAX(CASE WHEN cuenta_codigo = 'A8' THEN valor END) AS cta_a8  -- INMUEBLE, MOBILIARIO Y EQUIPO NETO,
    MAX(CASE WHEN cuenta_codigo = 'A9' THEN valor END) AS cta_a9  -- OTROS ACTIVOS,
    MAX(CASE WHEN cuenta_codigo = 'B1' THEN valor END) AS cta_b1  -- OBLIGACIONES CON EL PÚBLICO,
    MAX(CASE WHEN cuenta_codigo = 'B1.1' THEN valor END) AS cta_b1_1  -- Depósitos A La Vista,
    MAX(CASE WHEN cuenta_codigo = 'B1.2' THEN valor END) AS cta_b1_2  -- Depósitos de Ahorros,
    MAX(CASE WHEN cuenta_codigo = 'B1.3' THEN valor END) AS cta_b1_3  -- Depósitos a Plazo,
    MAX(CASE WHEN cuenta_codigo = 'B1.3.1' THEN valor END) AS cta_b1_3_1  -- Certificados Bancarios y de Depósitos,
    MAX(CASE WHEN cuenta_codigo = 'B1.3.2' THEN valor END) AS cta_b1_3_2  -- Cuentas a Plazo,
    MAX(CASE WHEN cuenta_codigo = 'B1.3.3' THEN valor END) AS cta_b1_3_3  -- C.T.S.,
    MAX(CASE WHEN cuenta_codigo = 'B1.3.4' THEN valor END) AS cta_b1_3_4  -- Otros,
    MAX(CASE WHEN cuenta_codigo = 'B1.4' THEN valor END) AS cta_b1_4  -- Depósitos Restringidos,
    MAX(CASE WHEN cuenta_codigo = 'B1.5' THEN valor END) AS cta_b1_5  -- Otras Obligaciones,
    MAX(CASE WHEN cuenta_codigo = 'B1.5.1' THEN valor END) AS cta_b1_5_1  -- A la Vista,
    MAX(CASE WHEN cuenta_codigo = 'B1.5.2' THEN valor END) AS cta_b1_5_2  -- Relacionadas con Inversiones,
    MAX(CASE WHEN cuenta_codigo = 'B2' THEN valor END) AS cta_b2  -- DEPÓSITOS DEL SISTEMA FINANCIERO Y ORGANISMOS INTERNACIONALES,
    MAX(CASE WHEN cuenta_codigo = 'B2.1' THEN valor END) AS cta_b2_1  -- Depósitos a la Vista,
    MAX(CASE WHEN cuenta_codigo = 'B2.2' THEN valor END) AS cta_b2_2  -- Depósitos de Ahorros,
    MAX(CASE WHEN cuenta_codigo = 'B2.3' THEN valor END) AS cta_b2_3  -- Depósitos a Plazo,
    MAX(CASE WHEN cuenta_codigo = 'B3' THEN valor END) AS cta_b3  -- FONDOS INTERBANCARIOS,
    MAX(CASE WHEN cuenta_codigo = 'B4' THEN valor END) AS cta_b4  -- ADEUDOS Y OBLIGACIONES FINANCIERAS,
    MAX(CASE WHEN cuenta_codigo = 'B4.1' THEN valor END) AS cta_b4_1  -- Instituciones Financieras del País,
    MAX(CASE WHEN cuenta_codigo = 'B4.2' THEN valor END) AS cta_b4_2  -- Empresas del Exterior y Organismos Internacionales,
    MAX(CASE WHEN cuenta_codigo = 'B5' THEN valor END) AS cta_b5  -- OBLIGACIONES EN CIRCULACIÓN NO SUBORDINADAS,
    MAX(CASE WHEN cuenta_codigo = 'B5.1' THEN valor END) AS cta_b5_1  -- Bonos de Arrendamiento Financiero,
    MAX(CASE WHEN cuenta_codigo = 'B5.2' THEN valor END) AS cta_b5_2  -- Instrumentos Hipotecarios,
    MAX(CASE WHEN cuenta_codigo = 'B5.3' THEN valor END) AS cta_b5_3  -- Otros Instrumentos de Deuda,
    MAX(CASE WHEN cuenta_codigo = 'B6' THEN valor END) AS cta_b6  -- CUENTAS POR PAGAR NETAS,
    MAX(CASE WHEN cuenta_codigo = 'B7' THEN valor END) AS cta_b7  -- INTERESES Y OTROS GASTOS DEVENGADOS POR PAGAR,
    MAX(CASE WHEN cuenta_codigo = 'B7.1' THEN valor END) AS cta_b7_1  -- Obligaciones con el Público,
    MAX(CASE WHEN cuenta_codigo = 'B7.2' THEN valor END) AS cta_b7_2  -- Depósitos del Sistema Financiero y Organismos Internacionales,
    MAX(CASE WHEN cuenta_codigo = 'B7.3' THEN valor END) AS cta_b7_3  -- Fondos Interbancarios,
    MAX(CASE WHEN cuenta_codigo = 'B7.4' THEN valor END) AS cta_b7_4  -- Adeudos y Obligaciones Financieras,
    MAX(CASE WHEN cuenta_codigo = 'B7.5' THEN valor END) AS cta_b7_5  -- Obligaciones en Circulación no Subordinadas,
    MAX(CASE WHEN cuenta_codigo = 'B7.6' THEN valor END) AS cta_b7_6  -- Cuentas por Pagar,
    MAX(CASE WHEN cuenta_codigo = 'B8' THEN valor END) AS cta_b8  -- OTROS PASIVOS,
    MAX(CASE WHEN cuenta_codigo = 'B9' THEN valor END) AS cta_b9  -- PROVISIONES,
    MAX(CASE WHEN cuenta_codigo = 'B9.1' THEN valor END) AS cta_b9_1  -- Créditos Indirectos,
    MAX(CASE WHEN cuenta_codigo = 'B9.2' THEN valor END) AS cta_b9_2  -- Otras Provisiones,
    MAX(CASE WHEN cuenta_codigo = 'B10' THEN valor END) AS cta_b10  -- OBLIGACIONES EN CIRCULACIÓN SUBORDINADAS 1/,
    MAX(CASE WHEN cuenta_codigo = 'C1' THEN valor END) AS cta_c1  -- Capital Social,
    MAX(CASE WHEN cuenta_codigo = 'C2' THEN valor END) AS cta_c2  -- Capital Adicional y Ajustes al Patrimonio,
    MAX(CASE WHEN cuenta_codigo = 'C3' THEN valor END) AS cta_c3  -- Capital Adicional,
    MAX(CASE WHEN cuenta_codigo = 'C4' THEN valor END) AS cta_c4  -- Reservas,
    MAX(CASE WHEN cuenta_codigo = 'C5' THEN valor END) AS cta_c5  -- Ajustes al Patrimonio,
    MAX(CASE WHEN cuenta_codigo = 'C6' THEN valor END) AS cta_c6  -- Resultados Acumulados,
    MAX(CASE WHEN cuenta_codigo = 'C7' THEN valor END) AS cta_c7  -- Resultados no realizados,
    MAX(CASE WHEN cuenta_codigo = 'C8' THEN valor END) AS cta_c8  -- Resultados Netos del Ejercicio,
    MAX(CASE WHEN cuenta_codigo = 'A' THEN valor END) AS cta_a  -- A,
    MAX(CASE WHEN cuenta_codigo = 'B' THEN valor END) AS cta_b  -- B,
    MAX(CASE WHEN cuenta_codigo = 'C' THEN valor END) AS cta_c  -- C
FROM raw.eeff_observacion
WHERE tipo_estado = 'balance'
GROUP BY periodo, fecha_cierre, nomb_correg, empresa_sbs,
         tipo_entidad, microfinanciera, nacional, moneda;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_eeff_balance_ancho
    ON marts.mv_eeff_balance_ancho (periodo, nomb_correg, moneda);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_balance_ancho_periodo
    ON marts.mv_eeff_balance_ancho (periodo);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_balance_ancho_entidad
    ON marts.mv_eeff_balance_ancho (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_balance_ancho_tipo
    ON marts.mv_eeff_balance_ancho (tipo_entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_eeff_balance_ancho IS
    'Pivot wide-format de EEFF balance. Auto-generado desde seeds.';
