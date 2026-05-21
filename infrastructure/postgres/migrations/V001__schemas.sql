-- =========================================================================
-- V001: Crear schemas base
-- Idempotente. Se aplica via tool de migracion (sqlx, atlas, o script bash)
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS auth;       -- usuarios (sync Clerk)
CREATE SCHEMA IF NOT EXISTS tenant;     -- orgs, memberships, branding
CREATE SCHEMA IF NOT EXISTS billing;    -- subs, invoices, entitlements
CREATE SCHEMA IF NOT EXISTS raw;        -- crudo del scraping
CREATE SCHEMA IF NOT EXISTS dw;         -- dimensiones y facts del DW
CREATE SCHEMA IF NOT EXISTS marts;      -- vistas materializadas para dashboards
CREATE SCHEMA IF NOT EXISTS api;        -- views read-only que expone la API
CREATE SCHEMA IF NOT EXISTS audit;      -- audit log multi-tenant

COMMENT ON SCHEMA auth IS 'Usuarios; sincronizado desde Clerk webhooks';
COMMENT ON SCHEMA tenant IS 'Organizaciones, membresias, branding white-label';
COMMENT ON SCHEMA billing IS 'Suscripciones y entitlements; sincronizado desde Stripe webhooks';
COMMENT ON SCHEMA raw IS 'Datos crudos del scraping SBS; staging antes de dbt';
COMMENT ON SCHEMA dw IS 'Data warehouse: dimensiones y facts (star schema)';
COMMENT ON SCHEMA marts IS 'Vistas materializadas optimizadas para dashboards';
COMMENT ON SCHEMA api IS 'Views read-only que la API consume (capa de seguridad)';
COMMENT ON SCHEMA audit IS 'Log de acciones sensibles por tenant';
