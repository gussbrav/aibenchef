-- =========================================================================
-- V162 — Auto-marcar como revisados los sospechosos historicos (<202001)
--
-- CONTEXTO: la vista raw.v_archivos_sospechosos (V135) detecta archivos
-- cuyo import tuvo `filas_insertadas << promedio_historico`. Util para
-- archivos recientes, pero genera ruido para archivos historicos donde
-- SBS tenia menos entidades registradas.
--
-- CASOS REALES (screenshot usuario 2026-08-10):
--   - 201204 financiera eeff: 378 / 2247 (17%)  → normal, en 2012 habia menos financieras
--   - 200907 financiera eeff: 144 / 1260 (11%)  → normal, en 2009 aun menos
--
-- Estos aparecen como "sospechosos" pero no son accionables — no vamos a
-- forzar re-descarga de un archivo de 2009 porque SBS ya no lo actualiza,
-- y aunque lo hicieramos, tendria el mismo tamano historico.
--
-- FIX: la vista ahora auto-excluye periodos anteriores a 2020, dejando
-- solo los sospechosos accionables. Los archivos historicos siguen en
-- raw.archivos_descargados con toda su data — solo dejan de aparecer en
-- el dashboard de "cargas sospechosas".
--
-- OPCION OVERRIDE: si en el futuro se necesita revisar los historicos,
-- consultar directo:
--   SELECT * FROM raw.detect_partial_ingest(id) FROM raw.archivos_descargados
--   WHERE periodo < 202001 ...
--
-- Threshold 202001 = enero 2020 (elegido por ser el corte donde la lista
-- de entidades SBS se estabiliza — cambios previos generaron muchos
-- falsos positivos). Configurable via un ALTER TABLE + config si escala.
-- =========================================================================

CREATE OR REPLACE VIEW raw.v_archivos_sospechosos AS
SELECT
    a.id,
    a.periodo,
    a.grupo,
    a.topico,
    a.nombre_archivo,
    a.tamanio_bytes,
    a.status,
    a.filas_insertadas,
    a.error_mensaje,
    a.descargado_en,
    a.procesado_en,
    raw.detect_partial_ingest(a.id) AS check_result
FROM raw.archivos_descargados a
WHERE a.status IN ('sospechoso', 'procesado')
  AND a.filas_insertadas IS NOT NULL
  AND NOT (raw.detect_partial_ingest(a.id) ->> 'ok')::boolean
  -- V162: auto-excluir historicos <202001 (ruido de falsos positivos).
  -- La lista de entidades SBS crecio mucho entre 2009-2020, por lo que
  -- comparar filas_insertadas de un archivo 2012 contra el promedio
  -- historico completo siempre da ratio bajo. No son accionables.
  AND a.periodo >= 202001
ORDER BY a.periodo DESC, a.grupo, a.topico;

COMMENT ON VIEW raw.v_archivos_sospechosos IS
    'V162: archivos cuyo import quedo sospechoso (rows << promedio historico), '
    'AUTO-EXCLUYENDO periodos <202001 (ruido de falsos positivos historicos). '
    'Consumir desde /dashboard/admin/pipeline para revisar y re-encolar con '
    'force_redownload=true. Para inspeccionar historicos: query directo a '
    'raw.archivos_descargados + raw.detect_partial_ingest(id).';
