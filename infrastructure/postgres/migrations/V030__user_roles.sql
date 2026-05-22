-- =========================================================================
-- V030: roles + estado en auth.users (user management)
--
-- Better Auth crea la tabla auth.users con id/email/name/email_verified/image.
-- Le agregamos columnas para gestion de usuarios desde la UI:
--   - role: admin (todo) | usuario (lectura analitica)
--   - status: active | suspended | invited (puede ingresar?)
--   - invited_by: quien lo invito (audit)
--
-- El primer usuario registrado se promueve automaticamente a admin
-- via trigger (asi siempre hay un admin sin tocar SQL manualmente).
-- =========================================================================

-- Role
ALTER TABLE auth.users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'usuario'
        CHECK (role IN ('admin', 'usuario'));

-- Status
ALTER TABLE auth.users
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'invited'));

-- Audit
ALTER TABLE auth.users
    ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_role   ON auth.users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON auth.users (status);

-- =========================================================================
-- Bootstrap: el primer usuario es admin (siempre debe haber un admin)
-- =========================================================================
CREATE OR REPLACE FUNCTION auth.bootstrap_first_admin() RETURNS TRIGGER AS $$
BEGIN
    -- Si no hay admins, el primer INSERT se promueve
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE role = 'admin') THEN
        NEW.role := 'admin';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_bootstrap_first_admin ON auth.users;
CREATE TRIGGER tg_bootstrap_first_admin
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION auth.bootstrap_first_admin();

-- Si ya hay usuarios existentes y ninguno es admin, promover el mas antiguo
DO $$
DECLARE
    primer_user_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE role = 'admin') THEN
        SELECT id INTO primer_user_id
        FROM auth.users
        ORDER BY created_at ASC NULLS FIRST
        LIMIT 1;
        IF primer_user_id IS NOT NULL THEN
            UPDATE auth.users SET role = 'admin' WHERE id = primer_user_id;
            RAISE NOTICE 'V030: usuario % promovido a admin (bootstrap)', primer_user_id;
        END IF;
    END IF;
END$$;

-- =========================================================================
-- Audit log de cambios de role/status (compliance)
-- =========================================================================
CREATE TABLE IF NOT EXISTS auth.users_audit (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    accion       TEXT NOT NULL CHECK (accion IN
                     ('promote_admin', 'demote_admin',
                      'suspend', 'unsuspend', 'invite', 'delete', 'update_profile')),
    detalle      TEXT,
    actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_audit_user
    ON auth.users_audit (user_id, created_at DESC);

COMMENT ON TABLE auth.users_audit IS
    'Cambios de role/status/perfil. Cumple compliance — quien hizo que cuando.';
