-- =========================================================================
-- V031: sistema de invitaciones (signup cerrado por token)
--
-- Workflow:
--   1. Admin crea invitacion -> { token, email, role, expires_at }
--   2. Sistema envia email (Resend) o admin copia el link manualmente
--   3. Usuario abre /signup?token=XXX -> ve email read-only + setea password
--   4. Tras signup exitoso, /api/v1/invitations/{token}/accept asigna el rol
--      y marca la invitacion como aceptada (consumida)
--
-- Token: 32 bytes hex random (gen_random_bytes::hex) — imposible de adivinar.
-- Expira: 7 dias por default (configurable per-invitation).
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.invitations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token        TEXT NOT NULL UNIQUE,
    email        TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'usuario'
                     CHECK (role IN ('admin', 'usuario')),
    invited_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    accepted_at  TIMESTAMPTZ,
    accepted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    revoked_at   TIMESTAMPTZ,
    notas        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invitations_email_lower CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS idx_invitations_token
    ON app.invitations (token)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_email
    ON app.invitations (email);

CREATE INDEX IF NOT EXISTS idx_invitations_pending
    ON app.invitations (created_at DESC)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Solo una invitacion pendiente por email (anti-spam)
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_email
    ON app.invitations (email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE app.invitations IS
    'Invitaciones para signup cerrado. Solo admins pueden crearlas. '
    'Cada token es unico, expira en 7 dias, y se consume al primer uso.';
