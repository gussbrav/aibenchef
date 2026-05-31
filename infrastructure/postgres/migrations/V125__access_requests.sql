-- =========================================================================
-- V125: Solicitudes publicas de acceso (waitlist B2B premium).
--
-- Patron de SaaS de clase mundial (Linear/Notion/Vercel/Anthropic):
-- pagina /signup esta cerrada por invitacion, pero un lead que aterriza ahi
-- puede llenar un form 'Solicitar acceso' con email + empresa + caso de uso.
-- La solicitud queda en app.access_requests con status pending hasta que un
-- admin la apruebe (1-click -> crea invitation automaticamente) o la
-- rechace.
--
-- Anti-spam:
--   * UNIQUE (email) — un lead ya rechazado no spamea con multiples requests
--     (se le permite UPDATE de su misma fila via ON CONFLICT en el endpoint).
--   * Rate limit por IP (no implementado en SQL — vive en una tabla aparte
--     app.access_request_rate_limits, simple kv: ip_hash -> ts ultima request).
--
-- Audit:
--   * recordAuditEvent para create / approve / reject / spam-mark.
--   * Cada accion del admin queda con actor_id en gov.audit_log.
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.access_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT NOT NULL UNIQUE
                            CHECK (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
    nombre              TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 120),
    empresa             TEXT NOT NULL CHECK (char_length(empresa) BETWEEN 2 AND 120),
    rol                 TEXT CHECK (rol IS NULL OR char_length(rol) <= 120),
    tamano_equipo       TEXT CHECK (tamano_equipo IS NULL OR tamano_equipo IN
                            ('solo', '2-10', '11-50', '51-200', '200+')),
    caso_uso            TEXT CHECK (caso_uso IS NULL OR char_length(caso_uso) <= 1500),
    source              TEXT NOT NULL DEFAULT 'signup_page',
    ip_hash             TEXT,         -- sha256(ip) para correlacionar sin guardar IP
    user_agent          TEXT,         -- truncado a 500 chars en el endpoint
    referer             TEXT,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                            ('pending', 'approved', 'rejected', 'spam')),
    notas_admin         TEXT,
    rejection_reason    TEXT,
    approved_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invitation_id       UUID,         -- backref a app.invitations cuando se aprueba
    rejected_at         TIMESTAMPTZ,
    rejected_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status_created
    ON app.access_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_requests_email_lower
    ON app.access_requests (lower(email));

CREATE INDEX IF NOT EXISTS idx_access_requests_ip_hash_created
    ON app.access_requests (ip_hash, created_at DESC)
    WHERE ip_hash IS NOT NULL;

DROP TRIGGER IF EXISTS tg_access_requests_updated_at ON app.access_requests;
CREATE TRIGGER tg_access_requests_updated_at
    BEFORE UPDATE ON app.access_requests
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.access_requests IS
    'Waitlist publica para acceso al beta. UNIQUE (email) evita duplicados. '
    'Admin aprueba con 1 click desde /dashboard/admin/access-requests, lo que '
    'crea automaticamente una invitation y dispara el email al solicitante.';

-- =========================================================================
-- Rate limit auxiliar (anti-spam): cada ip_hash puede crear max N requests
-- por ventana de tiempo. La logica de N/ventana vive en el endpoint, esta
-- tabla solo persiste timestamps recientes para que el chequeo sea atomico.
-- =========================================================================
CREATE TABLE IF NOT EXISTS app.access_request_rate (
    ip_hash       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ip_hash, created_at)
);

CREATE INDEX IF NOT EXISTS idx_access_request_rate_created
    ON app.access_request_rate (created_at DESC);

COMMENT ON TABLE app.access_request_rate IS
    'Token bucket simple: append-only ts por ip_hash. El endpoint hace COUNT '
    'sobre ventana de 1h antes de aceptar nueva request. Limpieza periodica '
    'borra entries > 24h.';

-- =========================================================================
-- Allowlist de dominios auto-aprobables (futuro): si un email corporativo
-- cae en este set, la solicitud se aprueba automaticamente. Util cuando
-- vendiste B2B a una empresa y queres que cualquier @cliente.com tenga
-- acceso sin tu intervencion manual.
-- =========================================================================
CREATE TABLE IF NOT EXISTS app.access_auto_approve_domains (
    domain       TEXT PRIMARY KEY CHECK (domain = lower(domain)),
    role         TEXT NOT NULL DEFAULT 'usuario'
                    CHECK (role IN ('admin', 'usuario')),
    added_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    notas        TEXT
);

COMMENT ON TABLE app.access_auto_approve_domains IS
    'Allowlist de dominios. Si llega una solicitud cuyo email termina en uno '
    'de estos dominios, se aprueba automaticamente con el rol indicado. '
    'Util para clientes B2B donde queres que todo el equipo del cliente '
    'tenga acceso sin onboarding 1-a-1.';

-- =========================================================================
-- Extender users_audit.accion para registrar el access_request en el log
-- comun del user (cuando se aprueba se le crea una invitacion).
-- =========================================================================
ALTER TABLE auth.users_audit DROP CONSTRAINT IF EXISTS users_audit_accion_check;
ALTER TABLE auth.users_audit ADD CONSTRAINT users_audit_accion_check
    CHECK (accion IN (
        'promote_admin', 'demote_admin',
        'suspend', 'unsuspend',
        'invite', 'delete',
        'update_profile', 'admin_rename',
        'password_reset',
        'access_request_approved'
    ));
