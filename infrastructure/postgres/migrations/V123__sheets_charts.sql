-- =========================================================================
-- V123: Charts embebidos en hojas de calculo.
--
-- Cada sheet puede tener N charts. Se persisten como array JSONB en la misma
-- tabla `app.sheets` (charts viven junto al sheet, no como entidad
-- independiente — borrar sheet borra los charts en cascada natural).
--
-- Shape esperado de cada elemento del array:
--   {
--     "id":         "<uuid>",
--     "tipo":       "line" | "bar" | "pie" | "area",
--     "titulo":     "Texto del titulo",
--     "rango":      "A1:C10",    -- rango de celdas que alimenta el chart
--     "headerRow":  true,        -- primera fila del rango son labels?
--     "xColumn":    "A",         -- columna del rango usada como eje X
--     "config": {
--        "ejeY":   { "titulo": "...", "formato": "number"|"percent"|"thousands" },
--        "ejeX":   { "titulo": "..." },
--        "colores": [...]        -- opcional, paleta custom
--     }
--   }
--
-- El motor (frontend) recalcula el chart cada vez que cambian las celdas
-- referenciadas por el rango. No hay snapshot.
-- =========================================================================

ALTER TABLE app.sheets
    ADD COLUMN IF NOT EXISTS charts JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN app.sheets.charts IS
    'Array de definiciones de chart embebidos en la hoja. Cada elemento '
    'tiene id, tipo, titulo, rango (ej A1:C10), headerRow, xColumn, config. '
    'El render usa recharts. Ver V123 para shape esperado.';
