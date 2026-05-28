-- =========================================================================
-- V098: Alineacion exhaustiva de dw.cabecera_maestra (issue #32)
--
-- Cierra los gaps detectados en EEFF Inspector:
--   1. "Inversiones en Subsidiarias..." (5 grupos) → codigo A3.5
--   2. "UTILIDAD (PÉRDIDA) POR VENTA DE CARTERA" (BANCOS+FIN) → codigo 8
--   3. "Provisones para Créditos Indirectos" (BANCOS+FIN) → codigo 12.2
--   4. "Provisiones para Bienes Realizados..." (CMAC+CRAC+EDPYMES) → codigo 12.5
--   5. Filas marker (fechas, anotaciones SBS) → es_header=true
--
-- Tras esta migration, las filas con codigo NULL deben ser SOLO markers
-- legitimos (es_header=true o es_seccion=true). El Inspector ya no las
-- marcara como "falta".
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1) A3.5 — Inversiones en Subsidiarias, Asociadas y Negocios Conjuntos
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET codigo='A3.5', nivel=3, updated_at=now()
 WHERE tipo_estado='balance' AND codigo IS NULL AND valido_hasta IS NULL
   AND nombre = 'Inversiones en Subsidiarias, Asociadas y Negocios Conjuntos';

INSERT INTO admin.cabecera_audit_log (tipo_estado, tipo_entidad, codigo, nombre, orden, accion, performed_by, motivo)
SELECT 'balance', tipo_entidad, 'A3.5', nombre, orden, 'update',
       'migration:V098', 'Alinear codigo A3.5 (issue #32)'
FROM dw.cabecera_maestra
WHERE codigo='A3.5' AND tipo_estado='balance' AND valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- 2) ER codigo 8 — UTILIDAD (PÉRDIDA) POR VENTA DE CARTERA (BANCOS, FIN)
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET codigo='8', nivel=2, es_header=true, updated_at=now()
 WHERE tipo_estado='resultados' AND codigo IS NULL AND valido_hasta IS NULL
   AND nombre = 'UTILIDAD (PÉRDIDA) POR VENTA DE CARTERA';

INSERT INTO admin.cabecera_audit_log (tipo_estado, tipo_entidad, codigo, nombre, orden, accion, performed_by, motivo)
SELECT 'resultados', tipo_entidad, '8', nombre, orden, 'update',
       'migration:V098', 'Alinear codigo 8 ER (issue #32)'
FROM dw.cabecera_maestra
WHERE codigo='8' AND tipo_estado='resultados' AND valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- 3) ER codigo 12.2 — Provisones para Créditos Indirectos (BANCOS, FIN)
--    Note: typo SBS "Provisones" (sin 'i') es el nombre real en el archivo.
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET codigo='12.2', nivel=3, updated_at=now()
 WHERE tipo_estado='resultados' AND codigo IS NULL AND valido_hasta IS NULL
   AND nombre = 'Provisones para Créditos Indirectos';

INSERT INTO admin.cabecera_audit_log (tipo_estado, tipo_entidad, codigo, nombre, orden, accion, performed_by, motivo)
SELECT 'resultados', tipo_entidad, '12.2', nombre, orden, 'update',
       'migration:V098', 'Alinear codigo 12.2 ER (issue #32)'
FROM dw.cabecera_maestra
WHERE codigo='12.2' AND tipo_estado='resultados' AND valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- 4) ER codigo 12.5 — Provisiones para Bienes Realizados... (CMAC/CRAC/EDPYMES)
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET codigo='12.5', nivel=3, updated_at=now()
 WHERE tipo_estado='resultados' AND codigo IS NULL AND valido_hasta IS NULL
   AND nombre = 'Provisiones para Bienes Realizados, Recidos en Pago y Adjudicados';

INSERT INTO admin.cabecera_audit_log (tipo_estado, tipo_entidad, codigo, nombre, orden, accion, performed_by, motivo)
SELECT 'resultados', tipo_entidad, '12.5', nombre, orden, 'update',
       'migration:V098', 'Alinear codigo 12.5 ER (issue #32)'
FROM dw.cabecera_maestra
WHERE codigo='12.5' AND tipo_estado='resultados' AND valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- 5) Marker rows: es_header=true (asi el Inspector NO los marca como "falta")
--
-- Estos son filas legitimas del archivo SBS que no son cuentas contables sino:
--   - Headers de bloque ("Balance General por Empresa Bancaria", "(En miles)")
--   - Fechas ("2026-03-31 00:00:00", "46112.0")
--   - Anotaciones ("Tipo de Cambio Contable:", "*", "**", "N/")
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET es_header=true, updated_at=now()
 WHERE valido_hasta IS NULL AND codigo IS NULL
   AND es_seccion=false AND es_header=false
   AND (
       nombre ILIKE '%Tipo de Cambio%'
    OR nombre ILIKE '%(En %)%'
    OR nombre ILIKE '%Balance General%'
    OR nombre ~ '^\d{4}-\d{2}'      -- fechas tipo "2026-03-31..."
    OR nombre ~ '^\d+\.\d+$'         -- fechas tipo "46112.0"
    OR nombre ILIKE '* %'            -- "* Mediante..."
    OR nombre ILIKE '**%'            -- "**Mediante..."
    OR nombre ~ '^\d+/'              -- "1/ Incluye..."
    OR nombre ILIKE 'Estado de%'     -- "Estado de Ganancias..."
   );

INSERT INTO admin.cabecera_audit_log (tipo_estado, tipo_entidad, codigo, nombre, orden, accion, performed_by, motivo)
SELECT tipo_estado, tipo_entidad, codigo, LEFT(nombre, 200), orden, 'update',
       'migration:V098', 'Marker es_header=true (no es cuenta real)'
FROM dw.cabecera_maestra
WHERE valido_hasta IS NULL AND codigo IS NULL AND es_header=true
  AND (
       nombre ILIKE '%Tipo de Cambio%'
    OR nombre ILIKE '%(En %)%'
    OR nombre ILIKE '%Balance General%'
    OR nombre ~ '^\d{4}-\d{2}'
    OR nombre ~ '^\d+\.\d+$'
    OR nombre ILIKE '* %'
    OR nombre ILIKE '**%'
    OR nombre ~ '^\d+/'
    OR nombre ILIKE 'Estado de%'
   );

COMMIT;

-- -------------------------------------------------------------------------
-- Las filas de CONTINGENTES (Avales, Lineas de Credito, Instrumentos
-- Derivados, Otras Cuentas Contingentes) NO se actualizan por ahora porque
-- requieren confirmar codigo prefix (D1/D2/D3/D4 vs otro). Quedan con
-- codigo NULL pero como es_header=false. Inspector las muestra como
-- "falta" hasta que asignemos codigo. Quedan para V099 con decision del
-- operador sobre prefijo.
-- -------------------------------------------------------------------------
