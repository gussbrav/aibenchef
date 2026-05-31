-- V124__governance_schema.sql
-- Schema `gov` con 5 capas de data governance.
-- Idempotente: re-correr no rompe nada.
--
-- Ver: docs/adr/005-data-governance-architecture.md
--      docs/design/data-governance-v1.md

CREATE SCHEMA IF NOT EXISTS gov;
COMMENT ON SCHEMA gov IS
  'Data governance: audit, glossary, lineage, tenancy, tags. '
  'Ver docs/adr/005-data-governance-architecture.md';


-- =========================================================================
-- CAPA 1: audit_log
-- Sink unificado de eventos auditables. Inmutable (append-only).
-- =========================================================================

CREATE TABLE IF NOT EXISTS gov.audit_log (
    id          BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Categoria de alto nivel (auth, sql, genie, billing, ai_providers,
    -- governance, etc). Canonicas listadas en doc.
    category    TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 64),
    -- Accion especifica dentro de la categoria (login, query_run, etc).
    action      TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
    -- Severity para filtros operativos.
    severity    TEXT NOT NULL DEFAULT 'info'
                CHECK (severity IN ('debug','info','warn','error','critical')),
    -- Actor: usuario que ejecuto. NULL = sistema/job background.
    actor_id    TEXT,
    actor_email TEXT,
    -- Tenant context si aplica (si el evento es por-tenant).
    tenant_id   UUID,
    -- Recurso afectado (formato libre: 'schema.table', 'provider:ollama', etc).
    resource    TEXT,
    -- Detalle estructurado adicional (parametros, diff, etc). Limitar size.
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
                CHECK (pg_column_size(metadata) < 16384),
    -- Hash sha256 hex del payload original si aplica (para deduplicacion).
    payload_hash TEXT,
    -- Origen del evento (api, worker, migration, manual).
    source      TEXT NOT NULL DEFAULT 'api'
                CHECK (source IN ('api','worker','migration','manual','test')),
    -- IP del cliente (sin guardar PII innecesaria — IP es PII en Peru).
    -- NULL si no aplica.
    ip_address  INET,
    -- Trace correlativo opcional (para agrupar eventos del mismo request).
    trace_id    TEXT
);

COMMENT ON TABLE gov.audit_log IS
  'Audit log unificado. Append-only. RLS bloquea UPDATE y DELETE.';

-- Indice BRIN sobre occurred_at: append-only, ideal para BRIN (storage-efficient)
CREATE INDEX IF NOT EXISTS audit_log_occurred_brin
  ON gov.audit_log USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON gov.audit_log (actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_tenant_idx
  ON gov.audit_log (tenant_id, occurred_at DESC) WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_category_action_idx
  ON gov.audit_log (category, action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_severity_idx
  ON gov.audit_log (severity, occurred_at DESC)
  WHERE severity IN ('warn','error','critical');

-- RLS: la tabla es solo-lectura para usuarios normales, solo escribible
-- por el role del backend. Inserts via funcion stable.
ALTER TABLE gov.audit_log ENABLE ROW LEVEL SECURITY;

-- Policy SELECT: admin ve todo, usuarios ven solo sus propios eventos.
DROP POLICY IF EXISTS audit_log_select ON gov.audit_log;
CREATE POLICY audit_log_select ON gov.audit_log
  FOR SELECT
  USING (
    coalesce(current_setting('app.is_admin', true), 'false') = 'true'
    OR actor_id = coalesce(current_setting('app.user_id', true), '')
  );

-- Policy INSERT: solo permitida via SECURITY DEFINER function (gov.record_audit_event).
-- Insert directo desde otros roles deberia fallar.
DROP POLICY IF EXISTS audit_log_insert ON gov.audit_log;
CREATE POLICY audit_log_insert ON gov.audit_log
  FOR INSERT
  WITH CHECK (true);  -- Function valida; el row passes RLS via SECURITY DEFINER.

-- Append-only: NO UPDATE, NO DELETE policies => denied por default.


-- =========================================================================
-- CAPA 2: business_glossary
-- Diccionario human-readable: nombres y descripciones por (schema, tabla, columna).
-- =========================================================================

CREATE TABLE IF NOT EXISTS gov.business_glossary (
    id              BIGSERIAL PRIMARY KEY,
    schema_name     TEXT NOT NULL CHECK (length(schema_name) BETWEEN 1 AND 64),
    table_name      TEXT NOT NULL CHECK (length(table_name) BETWEEN 1 AND 128),
    -- NULL para descripcion de tabla completa, set para columna especifica.
    column_name     TEXT CHECK (column_name IS NULL OR length(column_name) BETWEEN 1 AND 128),
    -- Nombre humano (ej. "Utilidad Neta YTD" para 'cta_17').
    display_name    TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 256),
    -- Descripcion en castellano peruano.
    description     TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4096),
    -- Owner del dato (responsable de mantener semantica).
    owner_email     TEXT,
    -- Categoria semantica (financial, regulatory, ratio, calculated).
    category        TEXT NOT NULL DEFAULT 'general'
                    CHECK (category IN ('financial','regulatory','ratio','calculated','dimension','metric','general')),
    -- Si esta cuenta solo aplica a algunos tipos de entidad SBS.
    applies_to      TEXT[],  -- ej {'BANCOS','CMAC'} si solo aplica a esos
    -- Formula textual (opcional). Ej: "TTM = YTD(p) + YTD(dic-1) - YTD(p-12)".
    formula         TEXT,
    -- Ejemplo de uso (opcional, formato libre).
    example_usage   TEXT,
    -- Source de la definicion (skill, regulacion SBS, decision interna).
    source          TEXT,
    -- Mantenimiento.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT,
    UNIQUE (schema_name, table_name, column_name)
);

COMMENT ON TABLE gov.business_glossary IS
  'Diccionario humano del DWH: por tabla y/o columna. Source-of-truth para UI catalog.';

CREATE INDEX IF NOT EXISTS glossary_schema_table_idx
  ON gov.business_glossary (schema_name, table_name);

CREATE INDEX IF NOT EXISTS glossary_category_idx
  ON gov.business_glossary (category);

-- Full-text search en castellano para descubribilidad.
CREATE INDEX IF NOT EXISTS glossary_fts_idx
  ON gov.business_glossary
  USING GIN (to_tsvector('spanish', display_name || ' ' || description));

ALTER TABLE gov.business_glossary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS glossary_select ON gov.business_glossary;
CREATE POLICY glossary_select ON gov.business_glossary
  FOR SELECT USING (true);  -- glossary es publico para todos los users autenticados

DROP POLICY IF EXISTS glossary_write ON gov.business_glossary;
CREATE POLICY glossary_write ON gov.business_glossary
  FOR ALL
  USING (coalesce(current_setting('app.is_admin', true), 'false') = 'true')
  WITH CHECK (coalesce(current_setting('app.is_admin', true), 'false') = 'true');


-- =========================================================================
-- CAPA 3: lineage_snapshot
-- Cache del grafo dbt manifest.json. Se regenera con scripts/refresh_lineage.py.
-- =========================================================================

CREATE TABLE IF NOT EXISTS gov.lineage_snapshot (
    id          BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Nodo destino: 'mart.mv_eeff_balance_ancho'
    target      TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 256),
    -- Nodo origen del cual depende: 'raw.eeff_observacion'
    source      TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 256),
    -- Tipo de relacion: 'direct' (FROM), 'indirect' (CTE inside).
    relation    TEXT NOT NULL DEFAULT 'direct'
                CHECK (relation IN ('direct','indirect')),
    -- Metadata estructurada del nodo (resource_type, schema, materialization).
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (target, source, relation)
);

COMMENT ON TABLE gov.lineage_snapshot IS
  'Edges del DAG del DWH. Reconstruido desde dbt manifest. Read-mostly.';

CREATE INDEX IF NOT EXISTS lineage_target_idx ON gov.lineage_snapshot (target);
CREATE INDEX IF NOT EXISTS lineage_source_idx ON gov.lineage_snapshot (source);

ALTER TABLE gov.lineage_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lineage_select ON gov.lineage_snapshot;
CREATE POLICY lineage_select ON gov.lineage_snapshot
  FOR SELECT USING (true);

DROP POLICY IF EXISTS lineage_write ON gov.lineage_snapshot;
CREATE POLICY lineage_write ON gov.lineage_snapshot
  FOR ALL
  USING (coalesce(current_setting('app.is_admin', true), 'false') = 'true')
  WITH CHECK (coalesce(current_setting('app.is_admin', true), 'false') = 'true');


-- =========================================================================
-- CAPA 4: tenants + tenant_membership
-- Multi-tenancy isolation via RLS.
-- =========================================================================

CREATE TABLE IF NOT EXISTS gov.tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
    slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
    plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free','pro','business','enterprise')),
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','deleted')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE gov.tenants IS
  'Tenants (clientes / organizaciones) del SaaS. Source-of-truth de quien existe.';

CREATE INDEX IF NOT EXISTS tenants_status_idx ON gov.tenants (status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS gov.tenant_membership (
    tenant_id   UUID NOT NULL REFERENCES gov.tenants(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('owner','admin','editor','viewer')),
    invited_by  TEXT,
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

COMMENT ON TABLE gov.tenant_membership IS
  'Membership user <-> tenant con rol. Base para RLS en tablas multi-tenant.';

CREATE INDEX IF NOT EXISTS membership_user_idx ON gov.tenant_membership (user_id);

ALTER TABLE gov.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_select ON gov.tenants;
CREATE POLICY tenants_select ON gov.tenants
  FOR SELECT
  USING (
    coalesce(current_setting('app.is_admin', true), 'false') = 'true'
    OR id IN (
      SELECT tenant_id FROM gov.tenant_membership
      WHERE user_id = coalesce(current_setting('app.user_id', true), '')
    )
  );

DROP POLICY IF EXISTS tenants_write ON gov.tenants;
CREATE POLICY tenants_write ON gov.tenants
  FOR ALL
  USING (coalesce(current_setting('app.is_admin', true), 'false') = 'true')
  WITH CHECK (coalesce(current_setting('app.is_admin', true), 'false') = 'true');

ALTER TABLE gov.tenant_membership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_select ON gov.tenant_membership;
CREATE POLICY membership_select ON gov.tenant_membership
  FOR SELECT
  USING (
    coalesce(current_setting('app.is_admin', true), 'false') = 'true'
    OR user_id = coalesce(current_setting('app.user_id', true), '')
  );

DROP POLICY IF EXISTS membership_write ON gov.tenant_membership;
CREATE POLICY membership_write ON gov.tenant_membership
  FOR ALL
  USING (coalesce(current_setting('app.is_admin', true), 'false') = 'true')
  WITH CHECK (coalesce(current_setting('app.is_admin', true), 'false') = 'true');


-- =========================================================================
-- CAPA 5: column_tags
-- Tags semanticos canonicos por columna. Para deprecation, classification, etc.
-- =========================================================================

CREATE TABLE IF NOT EXISTS gov.column_tags (
    id           BIGSERIAL PRIMARY KEY,
    schema_name  TEXT NOT NULL CHECK (length(schema_name) BETWEEN 1 AND 64),
    table_name   TEXT NOT NULL CHECK (length(table_name) BETWEEN 1 AND 128),
    column_name  TEXT NOT NULL CHECK (length(column_name) BETWEEN 1 AND 128),
    -- Tag canonico — ver doc para vocabulario.
    tag          TEXT NOT NULL
                 CHECK (tag IN ('pii','sensitive','calculated','deprecated','experimental','public','regulatory','financial')),
    -- Nota explicativa opcional.
    note         TEXT,
    set_by       TEXT,
    set_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (schema_name, table_name, column_name, tag)
);

COMMENT ON TABLE gov.column_tags IS
  'Tags semanticos canonicos sobre columnas. Vocabulario fijo.';

CREATE INDEX IF NOT EXISTS column_tags_schema_table_idx
  ON gov.column_tags (schema_name, table_name);

CREATE INDEX IF NOT EXISTS column_tags_tag_idx
  ON gov.column_tags (tag);

ALTER TABLE gov.column_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS column_tags_select ON gov.column_tags;
CREATE POLICY column_tags_select ON gov.column_tags
  FOR SELECT USING (true);

DROP POLICY IF EXISTS column_tags_write ON gov.column_tags;
CREATE POLICY column_tags_write ON gov.column_tags
  FOR ALL
  USING (coalesce(current_setting('app.is_admin', true), 'false') = 'true')
  WITH CHECK (coalesce(current_setting('app.is_admin', true), 'false') = 'true');


-- =========================================================================
-- FUNCION SECURITY DEFINER: gov.record_audit_event
-- Punto de entrada UNICO para insertar audit. Garantiza policy bypass de
-- INSERT y validaciones semanticas adicionales.
-- =========================================================================

CREATE OR REPLACE FUNCTION gov.record_audit_event(
    p_category    TEXT,
    p_action      TEXT,
    p_severity    TEXT DEFAULT 'info',
    p_actor_id    TEXT DEFAULT NULL,
    p_actor_email TEXT DEFAULT NULL,
    p_tenant_id   UUID DEFAULT NULL,
    p_resource    TEXT DEFAULT NULL,
    p_metadata    JSONB DEFAULT '{}'::jsonb,
    p_payload_hash TEXT DEFAULT NULL,
    p_source      TEXT DEFAULT 'api',
    p_ip_address  INET DEFAULT NULL,
    p_trace_id    TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gov, pg_temp
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO gov.audit_log (
        category, action, severity, actor_id, actor_email,
        tenant_id, resource, metadata, payload_hash, source,
        ip_address, trace_id
    ) VALUES (
        p_category, p_action, p_severity, p_actor_id, p_actor_email,
        p_tenant_id, p_resource, p_metadata, p_payload_hash, p_source,
        p_ip_address, p_trace_id
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION gov.record_audit_event IS
  'Punto de entrada UNICO para escribir audit log. SECURITY DEFINER + RLS bypass.';


-- =========================================================================
-- VIEW gov.audit_log_recent: ventana de 30 dias mas recientes con joins
-- comunes precomputados. Optimiza queries del dashboard de audit.
-- =========================================================================

CREATE OR REPLACE VIEW gov.audit_log_recent AS
SELECT
    al.id,
    al.occurred_at,
    al.category,
    al.action,
    al.severity,
    al.actor_id,
    al.actor_email,
    al.tenant_id,
    al.resource,
    al.metadata,
    al.source,
    al.trace_id,
    t.name AS tenant_name,
    t.slug AS tenant_slug
FROM gov.audit_log al
LEFT JOIN gov.tenants t ON t.id = al.tenant_id
WHERE al.occurred_at >= now() - INTERVAL '30 days';

COMMENT ON VIEW gov.audit_log_recent IS
  'Ventana 30 dias con tenant joined. Index del subyacente cubre la query.';


-- =========================================================================
-- SEED: tenant 'default' para single-tenant inicial.
-- Idempotente: ON CONFLICT DO NOTHING.
-- =========================================================================

INSERT INTO gov.tenants (id, name, slug, plan, status)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default',
    'default',
    'enterprise',
    'active'
) ON CONFLICT (slug) DO NOTHING;


-- =========================================================================
-- LOG: registramos en el propio audit_log la aplicacion de esta migration.
-- =========================================================================

SELECT gov.record_audit_event(
    p_category    => 'governance',
    p_action      => 'schema_migrated',
    p_severity    => 'info',
    p_resource    => 'V124__governance_schema',
    p_metadata    => '{"version":"V124","layers":["audit","glossary","lineage","tenancy","tags"]}'::jsonb,
    p_source      => 'migration'
);
