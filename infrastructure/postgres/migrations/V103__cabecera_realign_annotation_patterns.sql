-- =========================================================================
-- V103: cabecera_maestra cleanup de anotaciones SBS extendidas (issue #42)
--
-- CONTEXTO
--
-- V099 hizo cleanup inicial removiendo solo patrones `*`, `**`, `N/`. El
-- auditor F1 v2 (issue #42, 90 samples 2009-2026) descubrio mas patrones
-- de "anotaciones" — filas que NO son cuentas reales pero que vivian en
-- cabecera_maestra con codigo=NULL:
--
--   - Excel serial dates como header: "40543.0", "42400.0" (cell type DATE
--     serializada a numero crudo por openpyxl).
--   - ISO datetime: "2018-01-31 00:00:00".
--   - "Tipo de Cambio Contable: S/ X,XXX" (variable por mes).
--   - "Balance General por ..." / "Estado de Ganancias y Perdidas por ..."
--     (title bleed de la hoja).
--   - "(En miles de soles)" / "(En miles de nuevos soles)".
--   - "Actualizado al/el DD-MM-YYYY" (fecha de publicacion SBS).
--   - "(*) Con relacion a ..." (footnotes parentizadas, caso CRAC Luren).
--
-- El parser ahora detecta estos patrones via _is_annotation_or_footnote_extra
-- (issue #42) y los skipea con orden -= 1. Esta migracion alinea la
-- cabecera_maestra con esa nueva logica.
--
-- ESTRATEGIA (espejo de V099)
--
-- 1. Bump orden por 100000 para liberar espacio.
-- 2. DELETE rows con codigo=NULL matcheando los nuevos patrones.
-- 3. ROW_NUMBER renumera ordenes secuencialmente cerrando gaps.
-- 4. Verificacion: no debe haber duplicados.
--
-- POST-MIGRACION
--
-- Re-ingest de archivos eeff para que raw.eeff_observacion tenga codigos
-- correctos con la nueva cabecera. Periodos pre-V099 ya van a re-ingestarse
-- de todos modos en C (bulk re-ingest historico 200801-202412).
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: bump orden por 100000 para liberar espacio durante renumeracion
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET orden = orden + 100000
 WHERE valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- Step 2: DELETE rows-anotacion con codigo NULL
--
-- Patrones (espejo de _is_annotation_or_footnote_extra del importer, sin
-- los que V099 ya elimino: '*', '**', 'N/').
-- -------------------------------------------------------------------------
WITH deleted AS (
    DELETE FROM dw.cabecera_maestra
    WHERE valido_hasta IS NULL
      AND codigo IS NULL
      AND (
          -- Excel serial date como header crudo: "40543.0", "42400.00", "42400"
          nombre ~ '^\d{4,6}(\.0+)?$'
          -- ISO datetime: "2018-01-31 00:00:00" o "2020-12-31"
          OR nombre ~ '^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?$'
          -- Tipo de Cambio Contable variable por mes (sin importar mayuscula)
          OR LOWER(nombre) ~ '^tipo de cambio contable'
          -- Title bleed de la hoja
          OR LOWER(nombre) ~ '^balance general por'
          OR LOWER(nombre) ~ '^estado de ganancias y p[eé]rdidas'
          -- Unit notes (paren)
          OR LOWER(nombre) ~ '^\(en miles de (nuevos )?soles\)$'
          -- Publication date
          OR LOWER(nombre) ~ '^actualizado (al|el) '
          -- Footnotes parentizadas con asterisco
          OR nombre ~ '^\(\*+\)\s+'
      )
    RETURNING tipo_estado, tipo_entidad, orden, nombre
)
INSERT INTO admin.cabecera_audit_log
    (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
     payload_after, performed_by, motivo)
SELECT tipo_estado, tipo_entidad, NULL, LEFT(nombre, 200), orden, 'delete',
       jsonb_build_object('reason', 'anotacion_sbs_extendida_v103'),
       'migration:V103',
       'Issue #42: extendido el detector de anotaciones via auditor F1 v2'
FROM deleted;

-- -------------------------------------------------------------------------
-- Step 3: re-numerar orden via ROW_NUMBER cerrando gaps
-- -------------------------------------------------------------------------
WITH renum AS (
    SELECT
        tipo_estado, tipo_entidad, valido_desde, orden,
        ROW_NUMBER() OVER (
            PARTITION BY tipo_estado, tipo_entidad, valido_desde
            ORDER BY orden
        ) AS new_orden
    FROM dw.cabecera_maestra
    WHERE valido_hasta IS NULL
)
UPDATE dw.cabecera_maestra cm
   SET orden = renum.new_orden,
       updated_at = now()
  FROM renum
 WHERE cm.tipo_estado  = renum.tipo_estado
   AND cm.tipo_entidad = renum.tipo_entidad
   AND cm.valido_desde = renum.valido_desde
   AND cm.orden        = renum.orden
   AND cm.valido_hasta IS NULL;

COMMIT;

-- -------------------------------------------------------------------------
-- Verificacion: no debe haber 2 rows en mismo (tipo, entidad, orden) post
-- -------------------------------------------------------------------------
DO $$
DECLARE v_dups INT;
BEGIN
    SELECT COUNT(*) INTO v_dups FROM (
        SELECT tipo_estado, tipo_entidad, valido_desde, orden, COUNT(*) AS n
        FROM dw.cabecera_maestra
        WHERE valido_hasta IS NULL
        GROUP BY tipo_estado, tipo_entidad, valido_desde, orden
        HAVING COUNT(*) > 1
    ) d;
    IF v_dups > 0 THEN
        RAISE EXCEPTION 'V103: % orden duplicados detectados post-realign', v_dups;
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- Reporte: cuantas filas eliminadas y por que patron (informativo)
-- -------------------------------------------------------------------------
DO $$
DECLARE v_total INT; v_deleted INT;
BEGIN
    SELECT count(*) INTO v_total
      FROM dw.cabecera_maestra WHERE valido_hasta IS NULL;
    SELECT count(*) INTO v_deleted
      FROM admin.cabecera_audit_log
     WHERE performed_by = 'migration:V103' AND accion = 'delete';
    RAISE NOTICE 'V103: % rows-anotacion eliminadas, cabecera_maestra ahora % rows totales',
        v_deleted, v_total;
END $$;
