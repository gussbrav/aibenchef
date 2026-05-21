-- =========================================================================
-- V002: Tablas de auth, tenant y billing (sincronizadas desde Clerk + Stripe)
-- =========================================================================

-- ---------- auth.users ----------
CREATE TABLE IF NOT EXISTS auth.users (
  id              UUID PRIMARY KEY,                         -- mismo ID que Clerk
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users (email);

-- ---------- tenant.organizations ----------
CREATE TABLE IF NOT EXISTS tenant.organizations (
  id              UUID PRIMARY KEY,                         -- mismo ID que Clerk org
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  plan            TEXT NOT NULL DEFAULT 'trial'
                  CHECK (plan IN ('trial','starter','pro','business','enterprise','suspended')),
  trial_ends_at   TIMESTAMPTZ,
  branding        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orgs_plan ON tenant.organizations (plan);

-- ---------- tenant.memberships ----------
CREATE TABLE IF NOT EXISTS tenant.memberships (
  org_id          UUID NOT NULL REFERENCES tenant.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant.memberships (user_id);

-- ---------- billing.subscriptions ----------
CREATE TABLE IF NOT EXISTS billing.subscriptions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID NOT NULL REFERENCES tenant.organizations(id) ON DELETE CASCADE,
  stripe_subscription_id      TEXT NOT NULL UNIQUE,
  stripe_customer_id          TEXT NOT NULL,
  status                      TEXT NOT NULL
                              CHECK (status IN ('active','past_due','canceled','trialing','incomplete','incomplete_expired','unpaid','paused')),
  plan                        TEXT NOT NULL,
  current_period_start        TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subs_org ON billing.subscriptions (org_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON billing.subscriptions (status);

-- ---------- billing.entitlements ----------
CREATE TABLE IF NOT EXISTS billing.entitlements (
  org_id              UUID PRIMARY KEY REFERENCES tenant.organizations(id) ON DELETE CASCADE,
  grupos_acceso       TEXT[] NOT NULL DEFAULT ARRAY['cmac']::TEXT[],
  topicos_acceso      TEXT[] NOT NULL DEFAULT ARRAY['eeff']::TEXT[],
  meses_historico     INT NOT NULL DEFAULT 6,             -- -1 = todo
  max_users           INT NOT NULL DEFAULT 1,
  export_pdf          BOOLEAN NOT NULL DEFAULT false,
  export_excel        BOOLEAN NOT NULL DEFAULT false,
  api_enabled         BOOLEAN NOT NULL DEFAULT false,
  api_quota_monthly   INT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- audit.event_log ----------
CREATE TABLE IF NOT EXISTS audit.event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID,
  action          TEXT NOT NULL,
  resource        TEXT,
  metadata        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit.event_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit.event_log (action);

-- ---------- RLS habilitado en tablas tenant-scoped ----------
ALTER TABLE tenant.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.event_log ENABLE ROW LEVEL SECURITY;

-- Policies basadas en GUC app.tenant_id (seteada por middleware FastAPI)
CREATE POLICY tenant_isolation ON tenant.organizations
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON tenant.memberships
  USING (org_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON billing.subscriptions
  USING (org_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON billing.entitlements
  USING (org_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON audit.event_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
