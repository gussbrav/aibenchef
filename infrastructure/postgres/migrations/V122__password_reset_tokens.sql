-- =========================================================================
-- V122: Tokens de reset de contraseña (admin-driven).
--
-- Patron: el admin clickea "Copiar URL de restablecimiento" sobre un usuario,
-- el server genera un token unico y devuelve la URL /reset-password?token=...
-- El admin comparte el link por el canal que quiera (WhatsApp, Slack, etc).
-- El usuario lo abre, define contraseña nueva, el server consume el token.
--
-- Decision: NO usamos Better Auth's flujo de "forgot password" (requiere
-- emailVerification activo + relay de email confiable). El admin tiene
-- control directo y el link puede entregarse fuera de banda — util cuando
-- el email del usuario esta caido o todavia no esta verificado.
--
-- Seguridad:
--   - token es random 32 bytes (hex 64 chars) — espacio 2^256.
--   - expira en 1 hora por default (corto a proposito).
--   - usado UNA SOLA VEZ: campo used_at se setea al consumir, se valida en
--     siguiente uso.
--   - issued_by FK a auth.users — para auditar quien lo emitio.
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token       TEXT NOT NULL UNIQUE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    issued_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
    ON app.password_reset_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token
    ON app.password_reset_tokens (token)
    WHERE used_at IS NULL;

COMMENT ON TABLE app.password_reset_tokens IS
    'Tokens single-use para que el admin emita un link de reset de contraseña '
    'sin depender del flujo "forgot password" de Better Auth. Expira en 1h, '
    'used_at se setea al consumir.';

-- =========================================================================
-- Extender auth.users_audit.accion para registrar nuevos eventos del admin:
-- 'admin_rename' (cambio de nombre por admin) y 'password_reset' (consumo
-- de token de reset). Sin extender el CHECK los INSERT fallan.
-- =========================================================================
ALTER TABLE auth.users_audit DROP CONSTRAINT IF EXISTS users_audit_accion_check;
ALTER TABLE auth.users_audit ADD CONSTRAINT users_audit_accion_check
    CHECK (accion IN (
        'promote_admin', 'demote_admin',
        'suspend', 'unsuspend',
        'invite', 'delete',
        'update_profile', 'admin_rename',
        'password_reset'
    ));
