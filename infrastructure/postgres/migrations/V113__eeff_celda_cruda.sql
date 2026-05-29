-- =========================================================================
-- V113: raw.eeff_celda_cruda — cells crudos del .xls SBS por orden posicional
--
-- Que problema resuelve:
--   El EEFF Inspector hoy compara la cabecera_maestra contra lo que el parser
--   persistio en raw.eeff_observacion. Si el parser SKIPea o resuelve mal una
--   fila (caso real: issue #15, footnotes que desfasan los codigos), no hay
--   manera de detectarlo desde la UI porque la fila simplemente no aparece.
--
--   Esta tabla guarda los valores TAL COMO ESTAN EN EL XLS — incluso filas
--   que el parser descarto por no encontrar codigo. El inspector hace LEFT
--   JOIN por (periodo, nomb_correg, tipo_estado, orden) y muestra 3 columnas
--   nuevas (MN/ME/Total) + una diferencia contra valor_total ya extraido.
--
-- Como se llena:
--   monthly_eeff_importer (post issue #65) escribe a esta tabla en el mismo
--   flujo del import. El orden se asigna con el MISMO contador que usa el
--   resolver de codigos, asi se garantiza el match con cabecera_maestra.orden.
--
-- Backfill:
--   scripts/backfill_celda_cruda.py re-corre el import sin tocar
--   raw.eeff_observacion (idempotente por UNIQUE constraint).
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.eeff_celda_cruda (
    id              BIGSERIAL PRIMARY KEY,
    periodo         INTEGER NOT NULL,
    nomb_correg     TEXT NOT NULL,
    tipo_entidad    TEXT NOT NULL,
    tipo_estado     TEXT NOT NULL CHECK (tipo_estado IN ('balance', 'resultados')),
    orden           INTEGER NOT NULL,
    es_header       BOOLEAN NOT NULL DEFAULT FALSE,
    nombre_archivo  TEXT NOT NULL,
    valor_mn        NUMERIC(20, 4),
    valor_me        NUMERIC(20, 4),
    valor_total     NUMERIC(20, 4),
    archivo_id      UUID REFERENCES raw.archivos_descargados(id) ON DELETE SET NULL,
    source_file     TEXT,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Mismo orden numerico que cabecera_maestra (post-skip-annotations).
    -- Una entidad puede aparecer solo una vez por (periodo, tipo_estado, orden).
    CONSTRAINT eeff_celda_cruda_uniq
        UNIQUE (periodo, nomb_correg, tipo_estado, orden)
);

COMMENT ON TABLE raw.eeff_celda_cruda IS
'Cells crudos del .xls SBS — valores tal como aparecen en el archivo, antes del resolver de codigos. Usado por EEFF Inspector para validar que la extraccion no perdio data (issue #65).';

COMMENT ON COLUMN raw.eeff_celda_cruda.orden IS
'Orden posicional que matchea dw.cabecera_maestra.orden — incrementa una vez por fila no-vacia que no sea section marker ni annotation.';

COMMENT ON COLUMN raw.eeff_celda_cruda.valor_total IS
'TOTAL crudo leido del archivo. NULL si SBS no lo publica (caso BANCOS) — el parser lo calcula como MN+ME pero aqui guardamos NULL para distinguir publicado vs derivado.';

-- Lookup principal del inspector: por (periodo, entidad, tipo_estado) trae
-- todas las celdas ordenadas. Index covering para evitar bitmap heap scan.
CREATE INDEX IF NOT EXISTS idx_eeff_celda_cruda_lookup
    ON raw.eeff_celda_cruda (periodo, nomb_correg, tipo_estado, orden);

-- Index secundario para queries por archivo (debug / re-process).
CREATE INDEX IF NOT EXISTS idx_eeff_celda_cruda_archivo
    ON raw.eeff_celda_cruda (archivo_id)
    WHERE archivo_id IS NOT NULL;
