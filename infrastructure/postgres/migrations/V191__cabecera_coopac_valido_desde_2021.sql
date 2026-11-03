-- =========================================================================
-- V191: corregir valido_desde de cabeceras COOPAC de 202401 → 202101
--
-- V190 uso 202401 por precaucion. SBS publica datos COOPAC desde 2021,
-- por lo que el inspector mostraria vacio para periodos 202101-202312.
--
-- Como valido_desde es parte del PK, se hace DELETE + re-INSERT.
-- No afecta raw.eeff_observacion (no hay FK entre ambas tablas).
--
-- ROLLBACK:
--   DELETE FROM dw.cabecera_maestra
--     WHERE tipo_entidad LIKE 'COOPAC_%' AND valido_desde = 202101;
--   -- Luego re-ejecutar V190 o insertar manualmente con valido_desde=202401.
-- =========================================================================

BEGIN;

DELETE FROM dw.cabecera_maestra
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND valido_desde = 202401;

-- GYP
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, orden, codigo, nombre, nivel,
     es_header, es_total, es_seccion, valido_desde)
SELECT
    v.tipo_estado, g.tipo_entidad, v.orden, v.codigo, v.nombre,
    v.nivel, v.es_header, v.es_total, v.es_seccion, 202101
FROM (VALUES
    ('resultados'::TEXT,  1, '1',    'INGRESOS FINANCIEROS',                  2, TRUE,  FALSE, TRUE ),
    ('resultados',        2, '1.4',  'Creditos Directos',                     3, FALSE, FALSE, FALSE),
    ('resultados',        3, '1.3',  'Inversiones',                           3, FALSE, FALSE, FALSE),
    ('resultados',        4, '1.7',  'Diferencia de Cambio',                  3, FALSE, FALSE, FALSE),
    ('resultados',        5, '1.10', 'Otros',                                 3, FALSE, FALSE, FALSE),
    ('resultados',        6, '2',    'GASTOS FINANCIEROS',                    2, TRUE,  FALSE, TRUE ),
    ('resultados',        7, '2.1',  'Obligaciones con los Socios',           3, FALSE, FALSE, FALSE),
    ('resultados',        8, '2.4',  'Adeudos y Oblig Financieras',           3, FALSE, FALSE, FALSE),
    ('resultados',        9, '2.13', 'Otros Gastos Financieros',              3, FALSE, FALSE, FALSE),
    ('resultados',       10, '3',    'MARGEN FINANCIERO BRUTO',               2, FALSE, TRUE,  FALSE),
    ('resultados',       11, '4',    'PROVISIONES PARA CREDITOS DIRECTOS',    2, FALSE, FALSE, FALSE),
    ('resultados',       12, '6',    'INGRESOS POR SERVICIOS FINANCIEROS',    2, FALSE, FALSE, FALSE),
    ('resultados',       13, '7',    'GASTOS POR SERVICIOS FINANCIEROS',      2, FALSE, FALSE, FALSE),
    ('resultados',       14, '8',    'RESULTADO POR OPERAC FINANCIERAS',      2, FALSE, FALSE, FALSE),
    ('resultados',       15, '10',   'GASTOS ADMINISTRATIVOS',                2, TRUE,  FALSE, TRUE ),
    ('resultados',       16, '10.1', 'Personal',                              3, FALSE, FALSE, FALSE),
    ('resultados',       17, '10.2', 'Directorio',                            3, FALSE, FALSE, FALSE),
    ('resultados',       18, '10.3', 'Servicios Recibidos de Terceros',       3, FALSE, FALSE, FALSE),
    ('resultados',       19, '10.4', 'Impuestos y Contribuciones',            3, FALSE, FALSE, FALSE),
    ('resultados',       20, '12',   'PROVISIONES DEPREC Y AMORTIZACION',     2, TRUE,  FALSE, TRUE ),
    ('resultados',       21, '12.7', 'Depreciacion',                          3, FALSE, FALSE, FALSE),
    ('resultados',       22, '12.8', 'Amortizacion',                          3, FALSE, FALSE, FALSE),
    ('resultados',       23, '13',   'OTROS INGRESOS Y GASTOS',               2, FALSE, FALSE, FALSE),
    ('resultados',       24, '17',   'RESULTADO NETO DEL EJERCICIO',          2, FALSE, TRUE,  FALSE)
) AS v(tipo_estado, orden, codigo, nombre, nivel, es_header, es_total, es_seccion)
CROSS JOIN (VALUES
    ('COOPAC_N3'::TEXT), ('COOPAC_N2B'), ('COOPAC_N2A'), ('COOPAC_N1')
) AS g(tipo_entidad)
ON CONFLICT (tipo_estado, tipo_entidad, orden, valido_desde) DO NOTHING;

-- BG
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, orden, codigo, nombre, nivel,
     es_header, es_total, es_seccion, valido_desde)
SELECT
    v.tipo_estado, g.tipo_entidad, v.orden, v.codigo, v.nombre,
    v.nivel, v.es_header, v.es_total, v.es_seccion, 202101
FROM (VALUES
    ('balance'::TEXT,  1, 'A',      'ACTIVO',                                  1, TRUE,  FALSE, TRUE ),
    ('balance',        2, 'A1',     'DISPONIBLE',                              2, TRUE,  FALSE, FALSE),
    ('balance',        3, 'A1.1',   'Caja y Canje',                            3, FALSE, FALSE, FALSE),
    ('balance',        4, 'A1.2',   'Dep en Empresas del SF',                  3, FALSE, FALSE, FALSE),
    ('balance',        5, 'A1.4',   'Otros',                                   3, FALSE, FALSE, FALSE),
    ('balance',        6, 'A2',     'Fondos Interbancarios',                   2, FALSE, FALSE, FALSE),
    ('balance',        7, 'A3',     'Inversiones Financieras',                 2, FALSE, FALSE, FALSE),
    ('balance',        8, 'A4',     'CREDITOS DIRECTOS',                       2, TRUE,  FALSE, FALSE),
    ('balance',        9, 'A4.1',   'Creditos Vigentes',                       3, FALSE, FALSE, FALSE),
    ('balance',       10, 'A4.2',   'Creditos Reestructurados y Refinanciados',3, FALSE, FALSE, FALSE),
    ('balance',       11, 'A4.3',   'Creditos Vencidos',                       3, FALSE, FALSE, FALSE),
    ('balance',       12, 'A4.4',   'Creditos en Cobranza Judicial',           3, FALSE, FALSE, FALSE),
    ('balance',       13, 'A4.6',   'Provisiones',                             3, FALSE, FALSE, FALSE),
    ('balance',       14, 'A4.7',   'Intereses y Com no Devengados',           3, FALSE, FALSE, FALSE),
    ('balance',       15, 'A6',     'Activos Fijos',                           2, FALSE, FALSE, FALSE),
    ('balance',       16, 'A7',     'Otros Activos',                           2, FALSE, FALSE, FALSE),
    ('balance',       17, 'B',      'PASIVO',                                  1, TRUE,  FALSE, TRUE ),
    ('balance',       18, 'B1',     'OBLIGACIONES CON LOS SOCIOS',             2, TRUE,  FALSE, FALSE),
    ('balance',       19, 'B1.2',   'Depositos de Ahorro',                     3, FALSE, FALSE, FALSE),
    ('balance',       20, 'B1.3',   'Depositos a Plazo',                       3, FALSE, FALSE, FALSE),
    ('balance',       21, 'B1.3.3', 'Depositos CTS',                           4, FALSE, FALSE, FALSE),
    ('balance',       22, 'B3',     'Adeudos y Oblig Financieras',             2, FALSE, FALSE, FALSE),
    ('balance',       23, 'B6',     'Otros Pasivos',                           2, FALSE, FALSE, FALSE),
    ('balance',       24, 'C',      'PATRIMONIO',                              1, TRUE,  FALSE, TRUE ),
    ('balance',       25, 'C1',     'Capital Social',                          2, FALSE, FALSE, FALSE),
    ('balance',       26, 'C3',     'Reservas',                                2, FALSE, FALSE, FALSE),
    ('balance',       27, 'C5',     'Resultados Acumulados',                   2, FALSE, FALSE, FALSE),
    ('balance',       28, 'C6',     'Resultado Neto del Ejercicio',            2, FALSE, FALSE, FALSE)
) AS v(tipo_estado, orden, codigo, nombre, nivel, es_header, es_total, es_seccion)
CROSS JOIN (VALUES
    ('COOPAC_N3'::TEXT), ('COOPAC_N2B'), ('COOPAC_N2A'), ('COOPAC_N1')
) AS g(tipo_entidad)
ON CONFLICT (tipo_estado, tipo_entidad, orden, valido_desde) DO NOTHING;

COMMIT;
