-- =========================================================================
-- V023: app.tableros + app.tablero_widgets — dashboards multi-chart estilo Power BI
--
-- Un tablero contiene N widgets posicionados en una grilla (react-grid-layout).
-- Cada widget tiene:
--   - tipo: kpi, chart_line, chart_bar, chart_pie, table, markdown
--   - config: JSON con la configuracion especifica (ej: sql, chart axes,
--             colores, formato)
--   - posicion: x, y, w, h en la grilla (12-column standard)
--
-- Los widgets que necesitan data ejecutan SQL sandbox (app_sql_readonly).
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.tableros (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    es_publico   BOOLEAN NOT NULL DEFAULT FALSE,
    tags         TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tableros_nombre_chk CHECK (length(nombre) > 0)
);

CREATE INDEX IF NOT EXISTS idx_tableros_user ON app.tableros (user_id);

DROP TRIGGER IF EXISTS tg_tableros_updated_at ON app.tableros;
CREATE TRIGGER tg_tableros_updated_at
    BEFORE UPDATE ON app.tableros
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS app.tablero_widgets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tablero_id  UUID NOT NULL REFERENCES app.tableros(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN
                    ('kpi', 'chart_line', 'chart_bar', 'chart_pie',
                     'chart_area', 'chart_combo', 'table', 'markdown')),
    titulo      TEXT,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Posicion en la grilla (react-grid-layout standard, 12 columns)
    pos_x       INT NOT NULL DEFAULT 0,
    pos_y       INT NOT NULL DEFAULT 0,
    pos_w       INT NOT NULL DEFAULT 4,
    pos_h       INT NOT NULL DEFAULT 4,
    orden       INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tablero_widgets_tablero
    ON app.tablero_widgets (tablero_id, orden);

DROP TRIGGER IF EXISTS tg_tablero_widgets_updated_at ON app.tablero_widgets;
CREATE TRIGGER tg_tablero_widgets_updated_at
    BEFORE UPDATE ON app.tablero_widgets
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.tableros IS
    'Dashboards multi-widget estilo Power BI. Cada tablero pertenece a un '
    'usuario y contiene N widgets en una grilla posicional.';

COMMENT ON COLUMN app.tablero_widgets.config IS
    'JSON por tipo de widget. Ej kpi: {sql, label, format, comparePeriodo}; '
    'chart_*: {sql, x, y[], series_by, palette}; markdown: {content}.';
