-- =========================================================================
-- V201: Cabecera COOPAC completa — nombre_fuente + parent_codigo + cuentas faltantes
--
-- V190 insertó 24 cuentas GYP + 28 BG para display en EEFF Inspector.
-- Este archivo:
--   1. Actualiza las filas existentes con nombre_fuente (texto real del Excel
--      SBS COOPAC, que difiere del nombre de display) y parent_codigo (para
--      lookup jerárquico (parent_codigo, nombre_norm) → codigo).
--   2. Inserta ~36 cuentas adicionales que están en el importer Python pero
--      faltaban en cabecera_maestra.
--
-- Con esto, MonthlyCoopacEeffImporter puede cargar su mapa desde DB y
-- los mapas _GYP_CUENTAS/_BG_CUENTAS hardcodeados quedan obsoletos.
--
-- IDEMPOTENTE: ON CONFLICT DO NOTHING en INSERTs. UPDATE es idempotente
-- por naturaleza (sobrescribir con el mismo valor no causa error).
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. UPDATE filas existentes COOPAC: nombre_fuente + parent_codigo
--
--    nombre_fuente: texto real del Excel SBS COOPAC (lo que el importer
--    normaliza para buscar). NULL = el nombre display ya coincide tras normalizar.
--    parent_codigo: código del parent según jerarquía del BG/GYP.
-- ---------------------------------------------------------------------------
UPDATE dw.cabecera_maestra AS cm
SET
    nombre_fuente = u.nombre_fuente,
    parent_codigo = u.parent_codigo
FROM (VALUES
    -- ── BALANCE GENERAL ────────────────────────────────────────────────────
    -- Excel dice "TOTAL ACTIVO", display dice "ACTIVO"
    ('balance'::TEXT, 'A',      'TOTAL ACTIVO'::TEXT,                                            NULL::TEXT),
    ('balance',       'A1',     NULL,                                                             'A'       ),
    -- Excel dice "Caja", display dice "Caja y Canje"
    ('balance',       'A1.1',   'Caja',                                                           'A1'      ),
    -- Excel dice "Bancos y Corresponsales", display dice "Dep en Empresas del SF"
    ('balance',       'A1.2',   'Bancos y Corresponsales',                                        'A1'      ),
    ('balance',       'A1.4',   NULL,                                                             'A1'      ),
    -- Excel dice "FONDOS INTERCOOPERATIVOS" (sección Activo), display "Fondos Interbancarios"
    ('balance',       'A2',     'Fondos Intercooperativos',                                       'A'       ),
    -- Excel dice "INVERSIONES NETAS DE PROVISIONES", display "Inversiones Financieras"
    ('balance',       'A3',     'Inversiones Netas de Provisiones',                               'A'       ),
    -- Excel dice "CREDITOS NETOS DE PROVISIONES Y DE INGRESOS NO DEVENGADOS"
    ('balance',       'A4',     'Creditos Netos de Provisiones y de Ingresos no Devengados',      'A'       ),
    ('balance',       'A4.1',   'Vigentes',                                                       'A4'      ),
    ('balance',       'A4.2',   'Refinanciados y Reestructurados',                                'A4'      ),
    ('balance',       'A4.3',   'Vencidos',                                                       'A4'      ),
    ('balance',       'A4.4',   'En Cobranza Judicial',                                           'A4'      ),
    ('balance',       'A4.6',   NULL,                                                             'A4'      ),
    ('balance',       'A4.7',   'Intereses y Comisiones no Devengados',                           'A4'      ),
    -- Excel dice "INMUEBLE MOBILIARIO Y EQUIPO NETO", display "Activos Fijos"
    ('balance',       'A6',     'Inmueble Mobiliario y Equipo Neto',                              'A'       ),
    ('balance',       'A7',     NULL,                                                             'A'       ),
    -- Excel dice "TOTAL PASIVO", display dice "PASIVO"
    ('balance',       'B',      'TOTAL PASIVO',                                                   NULL      ),
    ('balance',       'B1',     NULL,                                                             'B'       ),
    ('balance',       'B1.2',   NULL,                                                             'B1'      ),
    ('balance',       'B1.3',   NULL,                                                             'B1'      ),
    ('balance',       'B1.3.3', NULL,                                                             'B1.3'    ),
    -- Excel dice "ADEUDOS Y OBLIGACIONES FINANCIERAS", display "Adeudos y Oblig Financieras"
    ('balance',       'B3',     'Adeudos y Obligaciones Financieras',                             'B'       ),
    ('balance',       'B6',     NULL,                                                             'B'       ),
    ('balance',       'C',      NULL,                                                             NULL      ),
    ('balance',       'C1',     NULL,                                                             'C'       ),
    ('balance',       'C3',     NULL,                                                             'C'       ),
    ('balance',       'C5',     NULL,                                                             'C'       ),
    ('balance',       'C6',     NULL,                                                             'C'       ),
    -- ── ESTADO DE RESULTADOS ───────────────────────────────────────────────
    ('resultados',    '1',      NULL,                                                             NULL      ),
    ('resultados',    '1.3',    NULL,                                                             '1'       ),
    ('resultados',    '1.4',    NULL,                                                             '1'       ),
    ('resultados',    '1.7',    NULL,                                                             '1'       ),
    ('resultados',    '1.10',   NULL,                                                             '1'       ),
    ('resultados',    '2',      NULL,                                                             NULL      ),
    ('resultados',    '2.1',    NULL,                                                             '2'       ),
    -- Excel dice "ADEUDOS Y OBLIGACIONES FINANCIERAS", display "Adeudos y Oblig Financieras"
    ('resultados',    '2.4',    'Adeudos y Obligaciones Financieras',                             '2'       ),
    ('resultados',    '2.13',   NULL,                                                             '2'       ),
    ('resultados',    '3',      NULL,                                                             NULL      ),
    ('resultados',    '4',      NULL,                                                             NULL      ),
    ('resultados',    '6',      NULL,                                                             NULL      ),
    ('resultados',    '7',      NULL,                                                             NULL      ),
    -- Excel dice "RESULTADO POR OPERACIONES FINANCIERAS", display "RESULTADO POR OPERAC FINANCIERAS"
    ('resultados',    '8',      'Resultado por Operaciones Financieras',                          NULL      ),
    ('resultados',    '10',     NULL,                                                             NULL      ),
    ('resultados',    '10.1',   NULL,                                                             '10'      ),
    ('resultados',    '10.2',   NULL,                                                             '10'      ),
    ('resultados',    '10.3',   NULL,                                                             '10'      ),
    ('resultados',    '10.4',   NULL,                                                             '10'      ),
    -- Excel dice "PROVISIONES DEPRECIACION Y AMORTIZACION", display "PROVISIONES DEPREC Y AMORTIZACION"
    ('resultados',    '12',     'Provisiones Depreciacion y Amortizacion',                        NULL      ),
    ('resultados',    '12.7',   NULL,                                                             '12'      ),
    ('resultados',    '12.8',   NULL,                                                             '12'      ),
    ('resultados',    '13',     NULL,                                                             NULL      ),
    ('resultados',    '17',     NULL,                                                             NULL      )
) AS u(tipo_estado, codigo, nombre_fuente, parent_codigo)
WHERE cm.tipo_entidad LIKE 'COOPAC_%'
  AND cm.tipo_estado  = u.tipo_estado
  AND cm.codigo       = u.codigo
  AND cm.valido_hasta IS NULL;

-- ---------------------------------------------------------------------------
-- 2. INSERT cuentas GYP faltantes (en importer Python pero no en cabecera)
--    24 entries × 4 tipos_entidad = 96 filas
-- ---------------------------------------------------------------------------
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, orden, codigo, nombre,
     nivel, es_header, es_total, es_seccion, valido_desde,
     nombre_fuente, parent_codigo)
SELECT
    v.tipo_estado, g.tipo_entidad, v.orden, v.codigo, v.nombre,
    v.nivel, v.es_header, v.es_total, v.es_seccion, 202401,
    v.nombre_fuente, v.parent_codigo
FROM (VALUES
--  t_estado      ord  codigo   nombre_display                           niv  hdr    tot    sec    nombre_fuente                                                   parent
    ('resultados'::TEXT, 25, '1.1',  'Disponible',                       3, FALSE, FALSE, FALSE, 'Disponible'::TEXT,                                              '1'::TEXT),
    ('resultados',       26, '1.2',  'Fondos Intercooperativos IF',       3, FALSE, FALSE, FALSE, 'Fondos Intercooperativos',                                      '1'      ),
    ('resultados',       27, '1.5',  'Ganancias Valorizacion Inversiones',3, FALSE, FALSE, FALSE, 'Ganancias por Valorizacion de Inversiones',                     '1'      ),
    ('resultados',       28, '1.6',  'Ganancias Inversiones Subsidiarias',3, FALSE, FALSE, FALSE, 'Ganancias por Inversiones en Subsidiarias y Asociadas',         '1'      ),
    ('resultados',       29, '1.8',  'Ganancias Derivados Financieros',   3, FALSE, FALSE, FALSE, 'Ganancias en Productos Financieros Derivados',                  '1'      ),
    ('resultados',       30, '2.2',  'Depositos de Coopac GF',            3, FALSE, FALSE, FALSE, 'Depositos de Coopac',                                           '2'      ),
    ('resultados',       31, '2.3',  'Fondos Intercooperativos GF',       3, FALSE, FALSE, FALSE, 'Fondos Intercooperativos',                                      '2'      ),
    ('resultados',       32, '2.5',  'Oblig Circ no Subordinadas',        3, FALSE, FALSE, FALSE, 'Obligaciones en Circulacion no Subordinadas',                   '2'      ),
    ('resultados',       33, '2.6',  'Oblig Circ Subordinadas',           3, FALSE, FALSE, FALSE, 'Obligaciones en Circulacion Subordinadas',                      '2'      ),
    ('resultados',       34, '2.7',  'Perdida Valorizacion Inversiones',  3, FALSE, FALSE, FALSE, 'Perdida por Valorizacion de Inversiones',                       '2'      ),
    ('resultados',       35, '2.8',  'Perdida Inversiones Subsidiarias',  3, FALSE, FALSE, FALSE, 'Perdida por Inversiones en Subsidiarias y Asociadas',           '2'      ),
    ('resultados',       36, '2.9',  'Primas Fondo Seguro Depositos',     3, FALSE, FALSE, FALSE, 'Primas al Fondo de Seguro de Depositos Cooperativo',            '2'      ),
    ('resultados',       37, '2.10', 'Diferencia de Cambio GF',           3, FALSE, FALSE, FALSE, 'Diferencia de Cambio',                                          '2'      ),
    ('resultados',       38, '2.11', 'Perdidas Derivados Financieros',    3, FALSE, FALSE, FALSE, 'Perdidas en Productos Financieros Derivados',                   '2'      ),
    -- Alias: "Otros" bajo GASTOS FINANCIEROS → mismo código que "Otros Gastos Financieros"
    ('resultados',       39, '2.13', 'Otros GF (alias Otros)',            3, FALSE, FALSE, FALSE, 'Otros',                                                         '2'      ),
    -- Gastos Admin subcuenta adicional
    ('resultados',       40, '10.5', 'Actividades Asociativas',           3, FALSE, FALSE, FALSE, 'Actividades Asociativas',                                       '10'     ),
    -- Cuentas top-level adicionales
    ('resultados',       41, '9',    'UTILID/PERDIDA VENTA CARTERA',      2, TRUE,  FALSE, FALSE, 'Utilidad Perdida por Venta de Cartera Crediticia',              NULL     ),
    ('resultados',       42, '15',   'RESULTADO ANTES IR',                2, FALSE, FALSE, FALSE, 'Resultado antes del Impuesto a la Renta',                       NULL     ),
    ('resultados',       43, '16',   'IMPUESTO A LA RENTA',               2, FALSE, FALSE, FALSE, 'Impuesto a la Renta',                                           NULL     ),
    -- Provisiones, Deprec y Amort subcuentas adicionales
    ('resultados',       44, '12.1', 'Prov Creditos Indirectos',          3, FALSE, FALSE, FALSE, 'Provisiones para Creditos Indirectos',                          '12'     ),
    ('resultados',       45, '12.2', 'Prov Deterioro Inversiones',        3, FALSE, FALSE, FALSE, 'Provisiones por Perdida por Deterioro de Inversiones',          '12'     ),
    ('resultados',       46, '12.3', 'Prov Incobrabilidad Ctas Cobrar',   3, FALSE, FALSE, FALSE, 'Provisiones para Incobrabilidad de Cuentas por Cobrar',         '12'     ),
    ('resultados',       47, '12.4', 'Prov Bienes Realizados',            3, FALSE, FALSE, FALSE, 'Provisiones para Bienes Realizados Recibidos en Pago y Adjudicados', '12'),
    ('resultados',       48, '12.5', 'Otras Provisiones',                 3, FALSE, FALSE, FALSE, 'Otras Provisiones',                                             '12'     )
) AS v(tipo_estado, orden, codigo, nombre, nivel, es_header, es_total, es_seccion, nombre_fuente, parent_codigo)
CROSS JOIN (VALUES
    ('COOPAC_N3'::TEXT), ('COOPAC_N2B'), ('COOPAC_N2A'), ('COOPAC_N1')
) AS g(tipo_entidad)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. INSERT cuentas BG faltantes (en importer Python pero no en cabecera)
--    12 entries × 4 tipos_entidad = 48 filas
-- ---------------------------------------------------------------------------
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, orden, codigo, nombre,
     nivel, es_header, es_total, es_seccion, valido_desde,
     nombre_fuente, parent_codigo)
SELECT
    v.tipo_estado, g.tipo_entidad, v.orden, v.codigo, v.nombre,
    v.nivel, v.es_header, v.es_total, v.es_seccion, 202401,
    v.nombre_fuente, v.parent_codigo
FROM (VALUES
--  t_estado   ord  codigo    nombre_display                              niv  hdr    tot    sec    nombre_fuente                                                    parent
    ('balance'::TEXT, 29, 'A5',    'Cuentas por Cobrar',                  2, TRUE,  FALSE, FALSE, 'Cuentas por Cobrar Netas de Provisiones'::TEXT,                 'A'::TEXT),
    ('balance',       30, 'A8',    'Rendimientos por Cobrar',              2, TRUE,  FALSE, FALSE, 'Rendimientos por Cobrar',                                       'A'      ),
    ('balance',       31, 'A_bir', 'Bienes Realizables',                   2, TRUE,  FALSE, FALSE, 'Bienes Realizables Recibidos en Pago y Adjudicados Netos',      'A'      ),
    -- B1 subcuenta adicional
    ('balance',       32, 'B1.1',  'Depositos a la Vista',                 3, FALSE, FALSE, FALSE, 'Depositos a la Vista',                                          'B1'     ),
    -- Pasivo categorías adicionales — incluye B_fi (Fondos Intercooperativos bajo Pasivo,
    -- distinto de A2 que es el mismo nombre bajo Activo — parent_codigo desambigua)
    ('balance',       33, 'B2',    'Depositos de Coopac',                  2, TRUE,  FALSE, FALSE, 'Depositos de Coopac',                                           'B'      ),
    ('balance',       34, 'B_fi',  'Fondos Intercooperativos Pasivo',      2, TRUE,  FALSE, FALSE, 'Fondos Intercooperativos',                                      'B'      ),
    ('balance',       35, 'B5',    'Cuentas por Pagar',                    2, TRUE,  FALSE, FALSE, 'Cuentas por Pagar',                                             'B'      ),
    ('balance',       36, 'B_igp', 'Intereses y Otros Gastos por Pagar',   2, TRUE,  FALSE, FALSE, 'Intereses y Otros Gastos por Pagar',                            'B'      ),
    ('balance',       37, 'B_prov','Provisiones Pasivo',                   2, TRUE,  FALSE, FALSE, 'Provisiones',                                                   'B'      ),
    ('balance',       38, 'B_sub', 'Oblig Circ Subordinadas Pasivo',       2, TRUE,  FALSE, FALSE, 'Obligaciones en Circulacion Subordinadas',                      'B'      ),
    -- Patrimonio subcuentas adicionales
    ('balance',       39, 'C2',    'Capital Adicional',                    3, FALSE, FALSE, FALSE, 'Capital Adicional',                                             'C'      ),
    ('balance',       40, 'C4',    'Ajustes al Patrimonio',                3, FALSE, FALSE, FALSE, 'Ajustes al Patrimonio',                                         'C'      )
) AS v(tipo_estado, orden, codigo, nombre, nivel, es_header, es_total, es_seccion, nombre_fuente, parent_codigo)
CROSS JOIN (VALUES
    ('COOPAC_N3'::TEXT), ('COOPAC_N2B'), ('COOPAC_N2A'), ('COOPAC_N1')
) AS g(tipo_entidad)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE dw.cabecera_maestra IS
    'Cabecera canónica por (tipo_estado, tipo_entidad, periodo). '
    'nombre_fuente: texto real en Excel SBS/ASFI (para matching en importer). '
    'parent_codigo: jerarquía explícita → lookup (parent_codigo, nombre_norm) → codigo. '
    'MonthlyCoopacEeffImporter carga su mapa desde aquí (V201+), no desde constantes Python.';
