-- =========================================================================
-- V119: raw.archivo_contenido — grid universal del contenido de cada .xls SBS.
--
-- Que problema resuelve:
--   El EEFF Inspector tiene comparacion "Procesado vs Archivo SBS crudo"
--   gracias a raw.eeff_celda_cruda. Para los OTROS 9 topicos (oficinas,
--   personal, clientes_*, depositos, colocaciones, castigos, indicadores,
--   creditos_depositos_geo) no existe esa comparacion.
--
--   Crear 9 tablas celda_cruda y modificar 9 importers es invasivo. Mejor:
--   una tabla universal que guarda el GRID del archivo (cada celda no vacia)
--   poblada por un script generico que reusa el reader read_xls() existente.
--
-- Diseno:
--   - 1 fila por celda no vacia del .xls
--   - Identificada por (archivo_id, sheet_name, fila, columna)
--   - valor_text: SIEMPRE poblado (representacion string de la celda)
--   - valor_numero: poblado si la celda es numerica (NUMERIC para queries)
--
--   El Inspector consulta esta tabla por archivo_id y muestra el grid completo
--   lado a lado con las tablas raw procesadas. Asi el operador puede verificar
--   cualquier celda contra el archivo.
--
-- Backfill: scripts/dump_archivo_contenido.py recorre todos los .xls de
-- /app/local-data/raw/ y popula esta tabla. Idempotente via UNIQUE constraint.
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.archivo_contenido (
    id              BIGSERIAL PRIMARY KEY,
    archivo_id      UUID NOT NULL REFERENCES raw.archivos_descargados(id) ON DELETE CASCADE,
    sheet_idx       INTEGER NOT NULL,           -- 0-based
    sheet_name      TEXT NOT NULL,
    fila            INTEGER NOT NULL,           -- 0-based
    columna         INTEGER NOT NULL,           -- 0-based
    valor_text      TEXT NOT NULL,              -- representacion string
    valor_numero    NUMERIC(28, 6),             -- si es numerico
    parsed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT archivo_contenido_uniq
        UNIQUE (archivo_id, sheet_idx, fila, columna)
);

COMMENT ON TABLE raw.archivo_contenido IS
'Grid universal del contenido de cada .xls SBS. Una fila por celda no vacia. Permite al Inspector mostrar el archivo crudo lado a lado con las tablas raw procesadas, sin modificar los 9 importers. Issue #65.';

COMMENT ON COLUMN raw.archivo_contenido.valor_text IS
'Representacion string de la celda (siempre poblada). Para celdas numericas, ademas valor_numero esta poblado.';

COMMENT ON COLUMN raw.archivo_contenido.valor_numero IS
'NUMERIC(28,6) si la celda es numerica. NULL para celdas textuales. Permite queries de SUM/AVG sin reparse.';

CREATE INDEX IF NOT EXISTS idx_archivo_contenido_lookup
    ON raw.archivo_contenido (archivo_id, sheet_idx, fila, columna);

-- Para queries que buscan un valor especifico en el archivo (ej. una empresa)
CREATE INDEX IF NOT EXISTS idx_archivo_contenido_valor_text
    ON raw.archivo_contenido USING gin (to_tsvector('simple', valor_text))
    WHERE length(valor_text) <= 200;
