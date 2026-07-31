-- =========================================================================
-- V135 — Guard anti-carga-parcial + soporte force_redownload
--
-- ROOT CAUSE del incidente 2026-07:
--   El archivo C-4103-my2026.xls (EEFF de EDPYMEs mayo 2026) se descargo
--   TRUNCADO desde SBS: 75,776 bytes vs ~290,000 promedio historico.
--   Solo contenia el sheet 'balance', faltaba 'resultados'. El importer
--   lo proceso sin error (marcado como 'procesado', 1,368 filas vs 2,322
--   esperadas), dejando a 6 EDPYMEs (Volvo Finance, Alternativa,
--   Santander Consumo, Vivela + 2 totales) SIN Estado de Resultados en
--   202605. Consecuencia UI: Utilidad, ROE, ROA y Punto de Equilibrio
--   en "—" para todo el peer group EDPYMEs, cierre mayo 2026.
--
-- FIX ESTRUCTURAL (3 capas):
--   1. Detector post-ingest — funcion raw.detect_partial_ingest(archivo_id)
--      que compara filas_insertadas vs promedio de los ultimos 6 meses
--      del mismo (grupo, topico). Threshold 60% del promedio.
--   2. Vista de sospechosos — raw.v_archivos_sospechosos para admin UI.
--   3. Soporte de re-descarga forzada — columna force_redownload en
--      admin.sync_jobs. El worker CLI lee este flag y pasa --force al
--      scrape para omitir el skip_if_exists (fija el bug de "archivo
--      corrupto queda cacheado en disco y nunca se re-baja").
--
-- El importer de EEFF (Python) tambien se endurece en el mismo commit:
-- validar que el .xls trae AMBOS sheets balance+resultados (no solo uno).
-- =========================================================================


-- ============ 1. Columna force_redownload en admin.sync_jobs ============
ALTER TABLE admin.sync_jobs
    ADD COLUMN IF NOT EXISTS force_redownload BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN admin.sync_jobs.force_redownload IS
    'Si true, el worker pasa --force al scrape para re-bajar el archivo '
    'aunque exista localmente. Sirve para recuperarse de descargas SBS '
    'truncadas/corruptas que quedaron cacheadas en disco (issue: incidente '
    'C-4103-my2026.xls, jul-2026).';


-- ============ 2. Estado nuevo 'sospechoso' en archivos_descargados ============
-- Reemplazar el CHECK constraint existente para admitir 'sospechoso'.
-- Semantica: el archivo se cargo sin excepcion pero el detector encontro
-- una senal de carga parcial (filas << promedio historico).
ALTER TABLE raw.archivos_descargados
    DROP CONSTRAINT IF EXISTS archivos_descargados_status_check;

ALTER TABLE raw.archivos_descargados
    ADD CONSTRAINT archivos_descargados_status_check
    CHECK (status IN (
        'descargado',
        'procesando',
        'procesado',
        'error',
        'omitido',
        'sospechoso',       -- NUEVO: carga completada pero anomalia detectada
        'no_publicado_sbs'  -- ya existente por V088+; consolidado aqui
    ));


-- ============ 3. Funcion detect_partial_ingest ============
-- Devuelve JSONB con {ok: bool, reason: text, ratio: numeric,
-- rows_actual: int, rows_promedio: numeric, n_meses_comparados: int}.
-- Threshold: 60% del promedio de los ultimos 6 meses del mismo
-- (grupo, topico), excluyendo el propio archivo evaluado y los meses
-- con status='no_publicado_sbs'. Requiere al menos 3 meses de historia
-- para no dar falsos positivos con topicos nuevos.
CREATE OR REPLACE FUNCTION raw.detect_partial_ingest(_archivo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    _grupo        TEXT;
    _topico       TEXT;
    _periodo      INT;
    _rows_actual  INT;
    _rows_prom    NUMERIC;
    _n_meses      INT;
    _ratio        NUMERIC;
    _threshold    CONSTANT NUMERIC := 0.60;
    _min_history  CONSTANT INT     := 3;
BEGIN
    SELECT grupo, topico, periodo, filas_insertadas
      INTO _grupo, _topico, _periodo, _rows_actual
      FROM raw.archivos_descargados
     WHERE id = _archivo_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', true, 'reason', 'archivo_no_encontrado');
    END IF;

    IF _rows_actual IS NULL OR _rows_actual = 0 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'rows_insertadas_null_o_cero',
            'rows_actual', _rows_actual
        );
    END IF;

    -- Promedio de los ultimos 6 meses del mismo (grupo, topico), excluyendo
    -- el archivo actual, meses sin publicacion SBS y filas nulas.
    SELECT AVG(filas_insertadas)::NUMERIC, COUNT(*)::INT
      INTO _rows_prom, _n_meses
      FROM (
        SELECT filas_insertadas
          FROM raw.archivos_descargados
         WHERE grupo   = _grupo
           AND topico  = _topico
           AND periodo < _periodo
           AND status  = 'procesado'
           AND filas_insertadas IS NOT NULL
           AND filas_insertadas > 0
         ORDER BY periodo DESC
         LIMIT 6
      ) sub;

    IF _n_meses < _min_history OR _rows_prom IS NULL OR _rows_prom = 0 THEN
        RETURN jsonb_build_object(
            'ok', true,
            'reason', 'sin_historia_suficiente',
            'n_meses_comparados', _n_meses
        );
    END IF;

    _ratio := _rows_actual::NUMERIC / _rows_prom;

    IF _ratio < _threshold THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'filas_muy_por_debajo_del_promedio',
            'ratio', ROUND(_ratio, 4),
            'threshold', _threshold,
            'rows_actual', _rows_actual,
            'rows_promedio', ROUND(_rows_prom, 1),
            'n_meses_comparados', _n_meses
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'ratio', ROUND(_ratio, 4),
        'rows_actual', _rows_actual,
        'rows_promedio', ROUND(_rows_prom, 1),
        'n_meses_comparados', _n_meses
    );
END;
$$;

COMMENT ON FUNCTION raw.detect_partial_ingest IS
    'Chequea si un archivo procesado tiene filas << promedio historico. '
    'Threshold: <60% del promedio de los ultimos 6 meses del mismo '
    '(grupo,topico) con >=3 meses de historia. Se llama desde el wrapper '
    '_import_file_with_audit del CLI Python inmediatamente despues del '
    'import. Si ok=false, el wrapper marca el archivo como sospechoso.';


-- ============ 4. Vista de archivos sospechosos ============
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
ORDER BY a.periodo DESC, a.grupo, a.topico;

COMMENT ON VIEW raw.v_archivos_sospechosos IS
    'Archivos cuyo import quedo sospechoso (rows << promedio historico). '
    'Consumir desde /dashboard/admin/pipeline para revisar y re-encolar '
    'con force_redownload=true.';
