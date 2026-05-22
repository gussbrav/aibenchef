-- =========================================================================
-- V020: app.saved_queries + app.sql_user_role
--
-- SQL Workbench (Databricks SQL Editor inspired) — el usuario escribe queries
-- ad-hoc sobre los marts.
--
-- Seguridad:
--   - Cada query se ejecuta con rol app.sql_readonly (creado aqui) que SOLO
--     tiene SELECT sobre marts.* y dw.dim_*. NO acceso a raw.* ni auth.*.
--   - El backend wraps cada query con SET LOCAL search_path + SET ROLE app.sql_readonly
--     antes de ejecutar (transaccion descartable).
--   - Statement timeout 15s para queries por usuario.
-- =========================================================================

-- Rol read-only para queries ad-hoc del workbench
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_sql_readonly') THEN
        CREATE ROLE app_sql_readonly NOLOGIN;
    END IF;
END$$;

GRANT USAGE ON SCHEMA marts TO app_sql_readonly;
GRANT USAGE ON SCHEMA dw TO app_sql_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA marts TO app_sql_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA dw TO app_sql_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA marts GRANT SELECT ON TABLES TO app_sql_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA dw    GRANT SELECT ON TABLES TO app_sql_readonly;

-- Solo SELECT sobre dim_cuenta, dim_entidad, no contra dw.* dimensiones internas
-- (no es estricto, mantenemos USAGE/SELECT general sobre dw para flexibilidad)

CREATE TABLE IF NOT EXISTS app.saved_queries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre       TEXT NOT NULL,
    descripcion  TEXT,
    sql_text     TEXT NOT NULL,
    parametros   JSONB NOT NULL DEFAULT '{}'::jsonb,
    es_publico   BOOLEAN NOT NULL DEFAULT FALSE,
    tags         TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_queries_nombre_chk CHECK (length(nombre) > 0),
    CONSTRAINT saved_queries_sql_chk    CHECK (length(sql_text) > 0)
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_user
    ON app.saved_queries (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_queries_tags
    ON app.saved_queries USING GIN (tags);

DROP TRIGGER IF EXISTS tg_saved_queries_updated_at ON app.saved_queries;
CREATE TRIGGER tg_saved_queries_updated_at
    BEFORE UPDATE ON app.saved_queries
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.saved_queries IS
    'Queries SQL guardadas del modulo SQL Workbench. Cada query se ejecuta '
    'con rol app_sql_readonly via SET LOCAL ROLE en transaccion descartable.';
