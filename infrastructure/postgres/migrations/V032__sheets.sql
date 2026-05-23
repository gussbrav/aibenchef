-- =========================================================================
-- V032: app.sheets — hojas de calculo editables (estilo Zoho Sheet / Excel)
--
-- Cada sheet es una grilla de N filas x M columnas con celdas editables.
-- Las celdas se almacenan como JSONB: { "A1": "valor", "B2": 123, ... }
-- (sparse — solo se persisten celdas con contenido).
--
-- MVP: sin formulas, sin formato. Edicion libre + autosave + export XLSX.
-- En el futuro: formulas (SUM, AVG, ...), formato condicional, multi-sheet.
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.sheets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    cells        JSONB NOT NULL DEFAULT '{}'::jsonb,
    n_rows       INT NOT NULL DEFAULT 100 CHECK (n_rows BETWEEN 10 AND 10000),
    n_cols       INT NOT NULL DEFAULT 26 CHECK (n_cols BETWEEN 5 AND 100),
    es_publico   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sheets_nombre_chk CHECK (length(nombre) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sheets_user ON app.sheets (user_id);

DROP TRIGGER IF EXISTS tg_sheets_updated_at ON app.sheets;
CREATE TRIGGER tg_sheets_updated_at
    BEFORE UPDATE ON app.sheets
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.sheets IS
    'Hojas de calculo editables. Celdas en JSONB sparse (solo cells con contenido). '
    'MVP: edicion libre + autosave + export XLSX. Sin formulas todavia.';
