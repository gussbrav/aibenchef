-- =========================================================================
-- V105: Cabecera versionada — registrar codigos legacy pre-2013 (issue #42)
--
-- CONTEXTO
--
-- SBS reformó el plan de cuentas a partir de enero 2013. Los archivos
-- publicados 2008-2012 usan codigos legacy que ya no existen post-2013:
--
--   Balance pre-2013:
--     C2  Capital Adicional y Ajustes al Patrimonio (split → C3 + C5)
--     C7  Resultados no realizados                  (eliminado)
--     A3.1 Negociables para Intermediación Financ.  (eliminado)
--     A3.6 Inversiones en subsidiarias y asociadas  (renombrado a A3.5)
--     A3.9 Ingresos por Compraventa de Valores...   (eliminado)
--
--   Resultados pre-2013:
--     1.9   / 2.12  Reajuste por Indexación         (eliminado)
--     4.1   Provisiones para Desvalorización Inv.   (eliminado)
--     4.2   Provisiones para Incobrabilidad Cred.   (mergeado en 4)
--     12.1  Provisiones para Contingencias y Otras  (eliminado)
--     13.1-13.3 Ingresos (Gastos) por...            (mergeado en 13)
--     15    PARTICIPACIÓN DE TRABAJADORES           (eliminado)
--
-- FIX (versioning por valido_desde/valido_hasta)
--
-- Cabecera_maestra usa valido_desde/valido_hasta como INTEGER YYYYMM.
-- Las cabeceras MODERNAS tienen valido_desde=200801 (legacy default) y
-- valido_hasta=NULL. Actualizamos las modernas a valido_desde=201301 y
-- agregamos las LEGACY como rows separadas con valido_desde=200801,
-- valido_hasta=201212.
--
-- El parser (post issue #42 fix) hace lookup name-based; si el archivo
-- es pre-2013 y trae un nombre legacy, lo resuelve al codigo legacy.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: actualizar cabecera moderna a valido_desde=201301
-- (era 200801 por default, pero conceptualmente solo aplica post-reforma)
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET valido_desde = 201301,
       updated_at = now()
 WHERE valido_hasta IS NULL
   AND valido_desde < 201301;

-- -------------------------------------------------------------------------
-- Step 2: insertar rows LEGACY pre-2013 para los 5 grupos
-- valido_desde=200801 (inicio data SBS), valido_hasta=201212
-- -------------------------------------------------------------------------

-- BALANCE legacy
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, codigo, nombre, orden, nivel, es_header, es_total,
     valido_desde, valido_hasta)
SELECT 'balance', g.te, l.codigo, l.nombre, l.orden, l.nivel, false, false,
       200801, 201212
  FROM (VALUES
      ('C2',   'Capital Adicional y Ajustes al Patrimonio',           100, 2),
      ('C7',   'Resultados no realizados',                             101, 2),
      ('A3.1', 'Negociables para Intermediación Financiera',           102, 3),
      ('A3.6', 'Inversiones en subsidiarias y asociadas',              103, 3),
      ('A3.9', 'Ingresos por Compraventa de Valores no Devengados',    104, 3)
  ) AS l(codigo, nombre, orden, nivel)
  CROSS JOIN (VALUES ('BANCOS'),('FINANCIERAS'),('CMAC'),('CRAC'),('EDPYMES')) AS g(te)
ON CONFLICT (tipo_estado, tipo_entidad, orden, valido_desde) DO NOTHING;

-- RESULTADOS legacy
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, codigo, nombre, orden, nivel, es_header, es_total,
     valido_desde, valido_hasta)
SELECT 'resultados', g.te, l.codigo, l.nombre, l.orden, l.nivel, false, false,
       200801, 201212
  FROM (VALUES
      ('1.9',  'Reajuste por Indexación',                              200, 3),
      ('2.12', 'Reajuste por Indexación',                              201, 3),
      ('4.1',  'Provisiones para Desvalorización de Inversiones',      202, 3),
      ('4.2',  'Provisiones para Incobrabilidad de Créditos',          203, 3),
      ('12.1', 'Provisiones para Contingencias y Otras',               204, 3),
      ('13.1', 'Ingresos (Gastos) por Recuperación de Créditos',       205, 3),
      ('13.2', 'Ingresos (Gastos) Extraordinarios',                    206, 3),
      ('13.3', 'Ingresos (Gastos) de Ejercicios Anteriores',           207, 3),
      ('15',   'PARTICIPACIÓN DE TRABAJADORES',                        208, 2)
  ) AS l(codigo, nombre, orden, nivel)
  CROSS JOIN (VALUES ('BANCOS'),('FINANCIERAS'),('CMAC'),('CRAC'),('EDPYMES')) AS g(te)
ON CONFLICT (tipo_estado, tipo_entidad, orden, valido_desde) DO NOTHING;

-- -------------------------------------------------------------------------
-- Audit log
-- -------------------------------------------------------------------------
INSERT INTO admin.cabecera_audit_log
    (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
     payload_after, performed_by, motivo)
SELECT tipo_estado, tipo_entidad, codigo, LEFT(nombre, 200), orden, 'insert',
       jsonb_build_object('valido_desde', valido_desde, 'valido_hasta', valido_hasta,
                          'reason', 'V105_legacy_pre_2013'),
       'migration:V105',
       'Issue #42: cabecera versionada pre-2013 (reforma SBS plan de cuentas)'
FROM dw.cabecera_maestra
WHERE valido_hasta = 201212;

COMMIT;

-- -------------------------------------------------------------------------
-- Reporte
-- -------------------------------------------------------------------------
DO $$
DECLARE v_legacy INT; v_modern INT;
BEGIN
    SELECT count(*) INTO v_legacy FROM dw.cabecera_maestra WHERE valido_hasta=201212;
    SELECT count(*) INTO v_modern FROM dw.cabecera_maestra WHERE valido_hasta IS NULL;
    RAISE NOTICE 'V105: % rows legacy (pre-2013) + % rows modernas = cabecera versionada lista',
        v_legacy, v_modern;
END $$;
