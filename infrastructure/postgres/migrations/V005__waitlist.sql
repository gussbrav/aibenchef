-- =========================================================================
-- V005: Schema waitlist + tabla entries
-- Para captar leads pre-launch desde la landing publica.
-- No depende de tenant (anonymous capture).
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS waitlist;

CREATE TABLE IF NOT EXISTS waitlist.entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    organization    TEXT,
    source          TEXT,                      -- 'landing', 'pricing', 'blog', etc.
    referrer        TEXT,                      -- HTTP Referer header
    ip_address      INET,
    user_agent      TEXT,
    utm_source      TEXT,
    utm_medium      TEXT,
    utm_campaign    TEXT,
    notified_at     TIMESTAMPTZ,               -- cuando se le mando el "ya estamos live"
    converted_at    TIMESTAMPTZ,               -- cuando se convirtio en cliente
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_email
    ON waitlist.entries (lower(email));

CREATE INDEX IF NOT EXISTS idx_waitlist_created
    ON waitlist.entries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_source
    ON waitlist.entries (source);

COMMENT ON TABLE waitlist.entries IS 'Leads pre-launch captados desde landing publica';
