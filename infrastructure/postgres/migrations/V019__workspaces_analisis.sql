-- =========================================================================
-- V019: app.workspaces_analisis — vistas guardadas del modulo Analisis Dinamico
--
-- Cada usuario puede guardar multiples configuraciones de pivot/grid/charts
-- (similar a las vistas guardadas de Tableau / Power BI o las hojas guardadas
-- en un libro de Excel).
--
-- config_json estructura propuesta (validada en backend, no en DDL):
-- {
--   "fuente": "balance" | "resultados" | "ratios",
--   "dimensions_rows": ["periodo", "nomb_correg"],
--   "dimensions_cols": ["moneda"],
--   "measures": ["cta_a", "cta_b", "cta_c"],
--   "agg": "SUM" | "AVG" | "MIN" | "MAX" | "NONE",
--   "filters": {
--     "tipo_entidad": ["BANCOS", "CMAC"],
--     "moneda": ["TOTAL"],
--     "periodo_desde": 202401,
--     "periodo_hasta": 202603
--   },
--   "formato_condicional": {
--     "cta_a": { "tipo": "heatmap", "min_color": "#fee5d9", "max_color": "#a50f15" }
--   },
--   "charts": [
--     { "tipo": "line", "x": "periodo", "y": ["cta_a"], "series_by": "nomb_correg" }
--   ]
-- }
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.workspaces_analisis (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    es_default   BOOLEAN NOT NULL DEFAULT FALSE,
    es_publico   BOOLEAN NOT NULL DEFAULT FALSE,    -- futuro: compartir read-only
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspaces_analisis_nombre_chk CHECK (length(nombre) > 0)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_analisis_user
    ON app.workspaces_analisis (user_id);

CREATE INDEX IF NOT EXISTS idx_workspaces_analisis_default
    ON app.workspaces_analisis (user_id)
    WHERE es_default = TRUE;

-- Solo un workspace default por usuario
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_analisis_default_per_user
    ON app.workspaces_analisis (user_id)
    WHERE es_default = TRUE;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_workspaces_analisis_updated_at ON app.workspaces_analisis;
CREATE TRIGGER tg_workspaces_analisis_updated_at
    BEFORE UPDATE ON app.workspaces_analisis
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.workspaces_analisis IS
    'Configuraciones guardadas del modulo Analisis Dinamico (Excel-clone). '
    'Equivalente a las "vistas guardadas" de Tableau o las hojas de un libro Excel.';
COMMENT ON COLUMN app.workspaces_analisis.config IS
    'JSON con dimensiones, medidas, filtros, formato condicional y charts. '
    'Validado en backend (zod/pydantic), no en DDL para flexibilidad.';
