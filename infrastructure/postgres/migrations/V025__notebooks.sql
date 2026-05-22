-- =========================================================================
-- V025: app.notebooks + app.notebook_cells
--
-- Notebooks lightweight estilo Databricks/Jupyter pero sin Python kernel.
-- Cells de tipo: markdown, sql, chart.
--
-- Cada cell SQL ejecuta contra el sandbox readonly (mismo que SQL Workbench).
-- Cada cell chart referencia el output de una cell SQL previa.
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.notebooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    titulo      TEXT NOT NULL,
    descripcion TEXT,
    es_publico  BOOLEAN NOT NULL DEFAULT FALSE,
    tags        TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notebooks_titulo_chk CHECK (length(titulo) > 0)
);

CREATE INDEX IF NOT EXISTS idx_notebooks_user ON app.notebooks (user_id);

DROP TRIGGER IF EXISTS tg_notebooks_updated_at ON app.notebooks;
CREATE TRIGGER tg_notebooks_updated_at
    BEFORE UPDATE ON app.notebooks
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS app.notebook_cells (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notebook_id  UUID NOT NULL REFERENCES app.notebooks(id) ON DELETE CASCADE,
    tipo         TEXT NOT NULL CHECK (tipo IN ('markdown', 'sql', 'chart')),
    contenido    TEXT NOT NULL DEFAULT '',
    config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Para charts: referencia a la cell SQL cuyo output usar
    fuente_cell_id UUID REFERENCES app.notebook_cells(id) ON DELETE SET NULL,
    orden        INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notebook_cells_notebook
    ON app.notebook_cells (notebook_id, orden);

DROP TRIGGER IF EXISTS tg_notebook_cells_updated_at ON app.notebook_cells;
CREATE TRIGGER tg_notebook_cells_updated_at
    BEFORE UPDATE ON app.notebook_cells
    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
