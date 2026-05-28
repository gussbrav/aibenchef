-- =========================================================================
-- V099: BUG CRITICO — re-align cabecera_maestra eliminando anotaciones SBS
-- que causaban desfase de 2 posiciones en el parser (issue #36).
--
-- ROOT CAUSE
--
-- Issue #15 (PR #17) agrego _is_annotation_or_footnote_extra() en el parser
-- que detecta filas SBS variables ("* Mediante Resolución...", "** ...",
-- "N/ ...") y hace `orden -= 1` para mantener sincronia.
--
-- PERO dw.cabecera_maestra fue construida ANTES de ese fix via init-maestra
-- que SI contaba esas anotaciones como orden. Resultado: cabecera tiene 2-4
-- entries extra (anotaciones) que el parser actual NO cuenta.
--
-- Esto causa desfase de 2 posiciones en Pasivo (B*) cuando el parser
-- procesa los archivos SBS:
--   - cabecera dice orden 46 = B1 OBLIGACIONES
--   - parser orden cuando lee OBLIGACIONES = 44 (porque salto 2 anotaciones)
--   - parser sigue, lee "Depositos de Ahorro" en orden 46
--   - asigna B1 a "Depositos de Ahorro" en lugar de OBLIGACIONES ❌
--
-- FIX
--
-- 1. DELETE filas anotacion en cabecera (con codigo NULL y nombre que
--    matchea * o ** o N/)
-- 2. Re-numerar orden sequencialmente (ROW_NUMBER) por (tipo_estado,
--    tipo_entidad, valido_desde) para cerrar gaps
--
-- Tras esto, el parser orden cuando lee una fila X = cabecera orden X.
-- Re-ingest archivos eeff para que raw.eeff_observacion tenga codigos
-- asignados correctamente.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- Step 1: bump orden por 100000 para liberar espacio durante renumeracion
-- -------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
   SET orden = orden + 100000
 WHERE valido_hasta IS NULL;

-- -------------------------------------------------------------------------
-- Step 2: DELETE anotaciones SBS (que el parser ya saltea via _is_annotation)
-- -------------------------------------------------------------------------
WITH deleted AS (
    DELETE FROM dw.cabecera_maestra
    WHERE valido_hasta IS NULL
      AND codigo IS NULL
      AND (nombre ~ '^\*' OR nombre ~ '^\*\*' OR nombre ~ '^\d+/')
    RETURNING tipo_estado, tipo_entidad, orden, nombre
)
INSERT INTO admin.cabecera_audit_log
    (tipo_estado, tipo_entidad, codigo, nombre, orden, accion,
     payload_after, performed_by, motivo)
SELECT tipo_estado, tipo_entidad, NULL, LEFT(nombre, 200), orden, 'delete',
       jsonb_build_object('reason', 'anotacion_sbs_realign_v099'),
       'migration:V099',
       'Bug #36: parser hace orden-=1 para anotaciones; cabecera tenia entries extra'
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
        RAISE EXCEPTION 'V099: % orden duplicados detectados post-realign', v_dups;
    END IF;
END $$;
