-- =========================================================================
-- V002: Tablas de auth, tenant y billing
-- auth.*  : schema compatible con Better Auth (TS lib)
-- tenant.*: orgs y memberships (gestionados por plugin organization de Better Auth)
-- billing.*: subscriptions y entitlements (sincronizados desde Stripe webhooks)
-- =========================================================================

-- ---------- auth.users (Better Auth) ----------
CREATE TABLE IF NOT EXISTS auth.users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  email_verified    BOOLEAN NOT NULL DEFAULT false,
  image             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users (email);

-- ---------- auth.sessions (Better Auth) ----------
CREATE TABLE IF NOT EXISTS auth.sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token             TEXT NOT NULL UNIQUE,
  expires_at        TIMESTAMPTZ NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth.sessions (expires_at);

-- ---------- auth.accounts (Better Auth OAuth + password) ----------
CREATE TABLE IF NOT EXISTS auth.accounts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id                 TEXT NOT NULL,
  account_id                  TEXT NOT NULL,
  access_token                TEXT,
  refresh_token               TEXT,
  access_token_expires_at     TIMESTAMPTZ,
  refresh_token_expires_at    TIMESTAMPTZ,
  scope                       TEXT,
  id_token                    TEXT,
  password                    TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON auth.accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_provider ON auth.accounts (provider_id, account_id);

-- ---------- auth.verifications (Better Auth tokens magic-link / email verify) ----------
CREATE TABLE IF NOT EXISTS auth.verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier    TEXT NOT NULL,
  value         TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON auth.verifications (identifier);

-- ---------- tenant.organizations ----------
CREATE TABLE IF NOT EXISTS tenant.organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  meses_historico     INT NOT NULL DEFAULT 6,
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

-- Policies basadas en GUC app.tenant_id (seteada por lib/db/index.ts withTenant())
DROP POLICY IF EXISTS tenant_isolation ON tenant.organizations;
CREATE POLICY tenant_isolation ON tenant.organizations
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON tenant.memberships;
CREATE POLICY tenant_isolation ON tenant.memberships
  USING (org_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON billing.subscriptions;
CREATE POLICY tenant_isolation ON billing.subscriptions
  USING (org_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON billing.entitlements;
CREATE POLICY tenant_isolation ON billing.entitlements
  USING (org_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON audit.event_log;
CREATE POLICY tenant_isolation ON audit.event_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
