-- V089 — Permitir status='no_publicado_sbs' en raw.archivos_descargados
--
-- El CHECK constraint existente solo permite: descargado / procesando /
-- procesado / error / omitido. Lo extendemos para incluir el nuevo estado
-- 'no_publicado_sbs' que indica que SBS retorno 404 o HTML de error para
-- ese periodo (el archivo NO existe en su intranet, no es un bug del scraper).
--
-- Tambien agrega COMMENTs documentando todos los valores convencionales y
-- indices parciales para acelerar las queries del dashboard que filtran por
-- estos estados.
--
-- Resuelve issue #3 (status que diferencia gap de SBS de descarga fallida).

-- Reemplazar CHECK constraint para incluir el nuevo valor.
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
        'no_publicado_sbs'
    ));

COMMENT ON COLUMN raw.archivos_descargados.status IS
    'Estado del archivo. Valores convencionales:
     - descargado: archivo bajado a disco, pendiente de procesar
     - procesado: ingestado a su tabla raw.* destino
     - no_publicado_sbs: SBS retorno 404 o HTML de error para este periodo
       (el archivo NO existe — es un gap real publicado por SBS, no un bug
       del scraper, ver issue #3)
     - error: fallo en parsing/ingesta, error_mensaje tiene el detalle';

CREATE INDEX IF NOT EXISTS ix_archivos_descargados_status_no_publicado
    ON raw.archivos_descargados (topico, anio, mes)
    WHERE status = 'no_publicado_sbs';

CREATE INDEX IF NOT EXISTS ix_archivos_descargados_status_descargado
    ON raw.archivos_descargados (topico, anio, mes)
    WHERE status = 'descargado';
