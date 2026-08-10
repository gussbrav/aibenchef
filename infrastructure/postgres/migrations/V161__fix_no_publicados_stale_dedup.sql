-- =========================================================================
-- V161 — Fix v_no_publicados_stale: dedup por (periodo, grupo, topico)
--
-- BUG REPORTADO (2026-08-10):
-- El panel /dashboard/admin/data-quality mostraba 2 archivos "atascados"
-- (Abr-24 y Feb-24 · banca_multiple · oficinas · 802-863 dias) despues
-- de que `aibenchef sbs work-jobs` HABIA descargado correctamente
-- los archivos (nuevas filas con status='procesado' del 2026-08-10).
--
-- ROOT CAUSE:
-- raw.archivos_descargados tiene 2+ filas por (periodo, grupo, topico)
-- porque el path_local varia entre corridas:
--
--   periodo | status              | actualizado         | path_local
--   --------+---------------------+---------------------+------------------------------------------
--   202402  | no_publicado_sbs    | 2026-05-27 01:57    | https://intranet2.sbs.gob.pe/.../B-2303-fe2024.xls
--   202402  | procesado           | 2026-08-10 16:49    | (path local diferente, tras descarga OK)
--
-- La vista v_no_publicados_stale (V157) miraba TODAS las filas
-- 'no_publicado_sbs', sin importar si habia una fila mas reciente con
-- status='procesado' para el mismo (periodo, grupo, topico). Resultado:
-- el panel seguia mostrando "atascados" aunque los archivos ya estaban
-- bajados y procesados.
--
-- FIX:
-- Aplicar DISTINCT ON (periodo, grupo, topico) ORDER BY actualizado_en DESC
-- para tomar SOLO el registro mas reciente por archivo, ANTES de aplicar
-- el filtro de status='no_publicado_sbs'. Asi si hay un 'procesado'
-- posterior, el 'no_publicado_sbs' viejo queda fuera de la vista.
--
-- Ademas: la misma logica se aplica a admin.check_missing_files (V157)
-- que tiene el mismo bug — cuenta 'procesado' + 'no_publicado_sbs viejo'
-- como archivos separados, cuando en realidad son la misma unidad
-- logica (mismo periodo+grupo+topico, distinto path).
-- =========================================================================

-- 1. FIX v_no_publicados_stale con DISTINCT ON

CREATE OR REPLACE VIEW admin.v_no_publicados_stale AS
WITH baseline_actual AS (
    SELECT
        grupo,
        topico,
        publish_lag_days
    FROM admin.expected_files_baseline
    WHERE valid_to IS NULL OR valid_to >= (SELECT MAX(periodo) FROM raw.archivos_descargados)
),
-- Dedup: 1 fila por (periodo, grupo, topico) tomando el registro MAS
-- RECIENTE segun actualizado_en. Asi si hubo un 'procesado' posterior a
-- un 'no_publicado_sbs', el registro efectivo es el 'procesado' (y no
-- aparecera en el filtro de abajo).
ultimo_por_archivo AS (
    SELECT DISTINCT ON (periodo, grupo, topico)
        periodo, grupo, topico, status, path_local, actualizado_en
    FROM raw.archivos_descargados
    ORDER BY periodo, grupo, topico, actualizado_en DESC
)
SELECT
    a.periodo,
    a.grupo,
    a.topico,
    a.path_local,
    a.actualizado_en,
    (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day')::date AS cierre_mes,
    b.publish_lag_days,
    (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + (b.publish_lag_days || ' days')::interval)::date AS fecha_esperada,
    (CURRENT_DATE - (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + (b.publish_lag_days || ' days')::interval)::date) AS dias_stale
FROM ultimo_por_archivo a
LEFT JOIN baseline_actual b ON b.grupo = a.grupo AND b.topico = a.topico
WHERE a.status = 'no_publicado_sbs'
  AND CURRENT_DATE > (make_date(a.periodo / 100, a.periodo % 100, 1)
        + INTERVAL '1 month' - INTERVAL '1 day'
        + ((COALESCE(b.publish_lag_days, 30) * 1.5)::int || ' days')::interval)::date
ORDER BY dias_stale DESC, a.periodo DESC, a.grupo, a.topico;

COMMENT ON VIEW admin.v_no_publicados_stale IS
    'V161 (fix): archivos SBS atascados como no_publicado_sbs por mas de '
    '1.5x el lag. Ahora usa DISTINCT ON para tomar solo el registro mas '
    'reciente por (periodo, grupo, topico) — asi si un work-jobs posterior '
    'proceso el archivo correctamente, no aparece como "atascado" aunque '
    'sigan existiendo filas viejas historicas con status no_publicado_sbs.';


-- 2. FIX admin.check_missing_files con la misma logica dedup

CREATE OR REPLACE FUNCTION admin.check_missing_files(_periodo INT)
RETURNS TABLE(
    grupo            TEXT,
    topico           TEXT,
    n_esperados      INT,
    n_encontrados    INT,
    n_faltantes      INT,
    publish_lag_days INT,
    fecha_esperada   DATE,
    is_overdue       BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    WITH periodo_info AS (
        SELECT
            _periodo AS periodo,
            (make_date(_periodo / 100, _periodo % 100, 1)
                + INTERVAL '1 month' - INTERVAL '1 day')::date AS cierre_mes
    ),
    baseline_con_stale AS (
        SELECT
            b.grupo,
            b.topico,
            b.n_archivos_esperados,
            b.publish_lag_days,
            (p.cierre_mes + (b.publish_lag_days || ' days')::interval)::date AS fecha_esperada,
            (p.cierre_mes + ((b.publish_lag_days * 1.5)::int || ' days')::interval)::date AS stale_threshold
        FROM admin.expected_files_baseline b
        CROSS JOIN periodo_info p
        WHERE b.valid_from <= _periodo
          AND (b.valid_to IS NULL OR b.valid_to >= _periodo)
    ),
    -- V161: dedup por (periodo, grupo, topico) — mismo pattern que
    -- v_no_publicados_stale para consistencia.
    ultimo_por_archivo AS (
        SELECT DISTINCT ON (periodo, grupo, topico)
            periodo, grupo, topico, status, actualizado_en
        FROM raw.archivos_descargados
        WHERE periodo = _periodo
        ORDER BY periodo, grupo, topico, actualizado_en DESC
    ),
    encontrados AS (
        SELECT a.grupo, a.topico, COUNT(*) AS n_encontrados
        FROM ultimo_por_archivo a
        LEFT JOIN baseline_con_stale b ON b.grupo = a.grupo AND b.topico = a.topico
        WHERE (
            a.status IN ('procesado', 'sospechoso')
            OR (
                a.status = 'no_publicado_sbs'
                AND a.actualizado_en >= b.stale_threshold::timestamptz
            )
        )
        GROUP BY a.grupo, a.topico
    )
    SELECT
        b.grupo,
        b.topico,
        b.n_archivos_esperados AS n_esperados,
        COALESCE(e.n_encontrados, 0) AS n_encontrados,
        GREATEST(b.n_archivos_esperados - COALESCE(e.n_encontrados, 0), 0) AS n_faltantes,
        b.publish_lag_days,
        b.fecha_esperada,
        (CURRENT_DATE > b.fecha_esperada
         AND COALESCE(e.n_encontrados, 0) < b.n_archivos_esperados) AS is_overdue
    FROM baseline_con_stale b
    LEFT JOIN encontrados e ON e.grupo = b.grupo AND e.topico = b.topico
    ORDER BY is_overdue DESC, n_faltantes DESC, b.grupo, b.topico;
$$;

COMMENT ON FUNCTION admin.check_missing_files IS
    'V161 (fix): mismo bug de dedup que v_no_publicados_stale — ahora '
    'agrupa por (periodo, grupo, topico) con DISTINCT ON para tomar solo '
    'el registro mas reciente. Consistente con V157 pero sin contar filas '
    'historicas viejas como si fueran archivos distintos.';


-- 3. Tambien fix f_ultimo_periodo_completeness_status (V139/V159) — mismo bug

CREATE OR REPLACE FUNCTION marts.f_ultimo_periodo_completeness_status(_periodo INT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    -- V161: dedup por (periodo, grupo, topico) para no contar filas
    -- historicas viejas como si fueran archivos separados.
    WITH ultimo_por_archivo AS (
        SELECT DISTINCT ON (periodo, grupo, topico)
            periodo, grupo, topico, status, actualizado_en
        FROM raw.archivos_descargados
        WHERE periodo = _periodo
        ORDER BY periodo, grupo, topico, actualizado_en DESC
    ),
    agregado_por_topico AS (
        SELECT topico,
               COUNT(*) FILTER (WHERE status = 'procesado')::int AS ok,
               COUNT(*) FILTER (WHERE status = 'no_publicado_sbs')::int AS pendientes,
               COUNT(*)::int AS total
        FROM ultimo_por_archivo
        GROUP BY topico
    ),
    detalle_parciales AS (
        SELECT
            a.topico,
            jsonb_build_object(
                'topico', a.topico,
                'grupos_faltantes',
                    COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'grupo', ad.grupo,
                            'status', ad.status,
                            'actualizado_en', ad.actualizado_en,
                            'dias_desde_cierre',
                                (CURRENT_DATE - (make_date(_periodo/100, _periodo%100, 1)
                                    + INTERVAL '1 month' - INTERVAL '1 day')::date)
                        ) ORDER BY ad.grupo)
                        FROM ultimo_por_archivo ad
                        WHERE ad.topico = a.topico
                          AND ad.status <> 'procesado'
                    ), '[]'::jsonb)
            ) AS detalle
        FROM agregado_por_topico a
        WHERE a.pendientes > 0 AND a.ok > 0
    )
    SELECT jsonb_build_object(
        'periodo', _periodo,
        'eeff_completo',
            COALESCE((SELECT ok >= 5 FROM agregado_por_topico WHERE topico = 'eeff'), false),
        'grupos_eeff_ok',
            COALESCE((SELECT ok FROM agregado_por_topico WHERE topico = 'eeff'), 0),
        'topicos_completos',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado_por_topico WHERE ok = total AND ok > 0), ARRAY[]::text[]),
        'topicos_parciales',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado_por_topico WHERE pendientes > 0 AND ok > 0), ARRAY[]::text[]),
        'topicos_faltantes',
            COALESCE((SELECT array_agg(topico ORDER BY topico)
                      FROM agregado_por_topico WHERE ok = 0), ARRAY[]::text[]),
        'topicos_parciales_detalle',
            COALESCE((SELECT jsonb_agg(detalle ORDER BY topico) FROM detalle_parciales), '[]'::jsonb)
    );
$$;

COMMENT ON FUNCTION marts.f_ultimo_periodo_completeness_status IS
    'V161: dedup por (periodo, grupo, topico) con DISTINCT ON — fix del '
    'bug donde filas viejas no_publicado_sbs seguian apareciendo como '
    'pendientes aunque el archivo ya estuviera procesado con path_local '
    'diferente. Consistente con v_no_publicados_stale y check_missing_files.';


-- 4. LIMPIEZA AGRESIVA de duplicados
--
-- Para cada (periodo, grupo, topico), mantenemos SOLO el registro con
-- actualizado_en MAS RECIENTE. Esto elimina no solo los 'no_publicado_sbs'
-- viejos que ya se resolvieron, sino cualquier duplicado historico creado
-- por el bug de path_local (URL guardada vs path local real).
--
-- Verificado en produccion (2026-08-10):
--   4 filas para banca_multiple/oficinas periodo 202402+202404
--   → 2 viejos con path_local = URL SBS (mayo 2026, bug)
--   → 2 nuevos con path_local correcto (agosto 2026, tras work-jobs)
--   Post-cleanup: 2 filas, solo las "procesado" correctas.
DELETE FROM raw.archivos_descargados a
WHERE EXISTS (
    SELECT 1 FROM raw.archivos_descargados b
    WHERE b.periodo = a.periodo
      AND b.grupo   = a.grupo
      AND b.topico  = a.topico
      AND (b.actualizado_en > a.actualizado_en
           OR (b.actualizado_en = a.actualizado_en AND b.id > a.id))
);

-- 5. TRIGGER PREVENTIVO — auto-upsert por unicidad natural
--
-- La unidad logica de un archivo SBS es (periodo, grupo, topico). El
-- path_local puede variar entre corridas (URL vs path local, .xls vs
-- .XLS, distintos storage backends) pero SIGUE siendo el mismo archivo.
--
-- NO usamos UNIQUE INDEX en (periodo, grupo, topico) porque los INSERTs
-- actuales del CLI (cli.py:207-213, cli.py:1400+) usan
-- ON CONFLICT (path_local) — un UNIQUE nuevo rompe esos INSERTs.
--
-- En su lugar: TRIGGER BEFORE INSERT que detecta duplicado logico y lo
-- convierte en UPDATE del registro existente. Transparente al codigo
-- Python (sin refactor) y previene reincidencia del bug automaticamente.
--
-- Estrategia:
--   1. BEFORE INSERT verifica si ya hay registro para (periodo, grupo, topico)
--   2. Si SI: UPDATE del existente con los datos del NEW, y RETURN NULL
--      (aborta el INSERT, la fila queda con solo el registro merged).
--   3. Si NO: RETURN NEW (INSERT procede normal).
--
-- Cero cambio en el codigo consumidor. UPSERT idempotente automatico.

CREATE OR REPLACE FUNCTION raw.archivos_descargados_prevent_duplicates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    _existing_id BIGINT;
BEGIN
    SELECT id INTO _existing_id
    FROM raw.archivos_descargados
    WHERE periodo = NEW.periodo
      AND grupo   = NEW.grupo
      AND topico  = NEW.topico
    LIMIT 1;

    IF _existing_id IS NOT NULL THEN
        -- Merge: pisamos con los datos del NEW pero preservamos el id
        -- original. path_local, status, tamanio, etc. se actualizan.
        UPDATE raw.archivos_descargados
        SET nombre_archivo  = NEW.nombre_archivo,
            path_local      = NEW.path_local,
            source_url      = COALESCE(NEW.source_url, source_url),
            tamanio_bytes   = COALESCE(NEW.tamanio_bytes, tamanio_bytes),
            md5_hash        = COALESCE(NEW.md5_hash, md5_hash),
            formato         = COALESCE(NEW.formato, formato),
            status          = NEW.status,
            error_mensaje   = NEW.error_mensaje,
            actualizado_en  = NOW()
        WHERE id = _existing_id;
        RETURN NULL;  -- Aborta el INSERT (ya hicimos UPDATE del existente).
    END IF;
    RETURN NEW;  -- No hay duplicado — INSERT procede normal.
END;
$$;

DROP TRIGGER IF EXISTS trg_archivos_descargados_dedup
    ON raw.archivos_descargados;
CREATE TRIGGER trg_archivos_descargados_dedup
    BEFORE INSERT ON raw.archivos_descargados
    FOR EACH ROW
    EXECUTE FUNCTION raw.archivos_descargados_prevent_duplicates();

COMMENT ON TRIGGER trg_archivos_descargados_dedup ON raw.archivos_descargados IS
    'V161: auto-UPSERT por (periodo, grupo, topico). Previene duplicados '
    'logicos aunque el path_local cambie entre corridas (URL vs path local, '
    'diferentes extensiones, etc). Fix definitivo del bug 2026-08-10 donde '
    'archivos aparecian atascados aunque ya estuvieran procesados.';
