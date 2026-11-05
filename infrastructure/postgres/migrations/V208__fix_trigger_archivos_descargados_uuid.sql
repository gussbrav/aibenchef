-- =========================================================================
-- V208: Corregir type mismatch en trigger archivos_descargados_prevent_duplicates
--
-- Bug: la variable _existing_id estaba declarada como BIGINT pero
-- raw.archivos_descargados.id es UUID (gen_random_uuid()).
-- Efecto: el trigger lanzaba "invalid input syntax for type bigint: uuid"
-- en cada INSERT, marcando los sync_jobs como failed aunque el scrape
-- e import habian funcionado correctamente.
--
-- Fix: cambiar BIGINT -> UUID en la declaracion de la variable.
-- =========================================================================

CREATE OR REPLACE FUNCTION raw.archivos_descargados_prevent_duplicates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    _existing_id UUID;
BEGIN
    SELECT id INTO _existing_id
    FROM raw.archivos_descargados
    WHERE periodo = NEW.periodo
      AND grupo   = NEW.grupo
      AND topico  = NEW.topico
    LIMIT 1;

    IF _existing_id IS NOT NULL THEN
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
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;
