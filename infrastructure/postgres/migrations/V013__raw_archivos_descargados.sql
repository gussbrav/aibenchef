-- =========================================================================
-- V013: Tabla raw.archivos_descargados — registro de cada .xls descargado
-- por el scraper. Da visibilidad para admin UI y trazabilidad de procesamiento.
--
-- Cada fila representa UN archivo fisico descargado desde SBS.
-- El scraper inserta despues de cada download exitoso.
-- El importer actualiza status='procesado' despues de cargar a raw.eeff_observacion.
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.archivos_descargados (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificacion (extraida del path/url)
    grupo           TEXT NOT NULL,
    topico          TEXT NOT NULL,
    periodo         INTEGER NOT NULL,
    anio            INTEGER NOT NULL,
    mes             INTEGER NOT NULL,

    -- Archivo fisico
    nombre_archivo  TEXT NOT NULL,
    path_local      TEXT NOT NULL,
    source_url      TEXT NOT NULL,

    -- Metadata
    tamanio_bytes   BIGINT NOT NULL,
    md5_hash        TEXT,
    formato         TEXT,                       -- biff / xlsx / xlsb / html / xml2003

    -- Status de procesamiento
    status          TEXT NOT NULL DEFAULT 'descargado'
                       CHECK (status IN ('descargado', 'procesando', 'procesado', 'error', 'omitido')),
    filas_insertadas INTEGER,
    error_mensaje   TEXT,
    procesado_en    TIMESTAMPTZ,

    -- Timestamps
    descargado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_archivos_path_local
    ON raw.archivos_descargados (path_local);

CREATE INDEX IF NOT EXISTS idx_archivos_grupo_topico
    ON raw.archivos_descargados (grupo, topico);

CREATE INDEX IF NOT EXISTS idx_archivos_periodo
    ON raw.archivos_descargados (periodo DESC);

CREATE INDEX IF NOT EXISTS idx_archivos_status
    ON raw.archivos_descargados (status);

COMMENT ON TABLE raw.archivos_descargados IS
    'Registro de cada archivo .xls descargado por el scraper SBS. '
    'Permite trazabilidad y visibilidad en UI admin sin depender de acceso '
    'al disco local donde residen los archivos fisicos.';
