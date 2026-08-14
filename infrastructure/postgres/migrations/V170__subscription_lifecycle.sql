-- =========================================================================
-- V170 — Ciclo de vida de suscripciones: expiraciones, notas, last_login
-- =========================================================================
--
-- Contexto: para operar el negocio en fase manual (pre-Culqi/Stripe)
-- necesitamos:
--   1. Saber cuando expira cada plan pagado -> downgrade automatico.
--   2. Registrar quien cambio el plan y por que -> auditoria comercial.
--   3. Ver ultimo login por usuario -> churn/dormant analysis.
--
-- Todos los campos son NULLABLE y con default None:
--   - Users existentes en 'free' quedan igual.
--   - Users existentes en 'pro/business/academic' quedan sin expires_at
--     (interpretado como "perpetuo mientras admin no lo cambie").
--
-- El trigger sobre auth.sessions actualiza auth.users.last_login_at cada vez
-- que Better Auth crea una sesion. Es cheap (una fila por login) y evita
-- que la lista de usuarios haga N subqueries.
--
-- Idempotente. Backward compatible.
-- =========================================================================

-- ---------- Columnas de ciclo de vida ----------
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS last_login_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_changed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_changed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_notes       TEXT;

COMMENT ON COLUMN auth.users.last_login_at IS
  'Timestamp del ultimo login. Actualizado por trigger sobre auth.sessions '
  '(fn_touch_last_login). NULL = nunca logueado desde signup.';

COMMENT ON COLUMN auth.users.plan_started_at IS
  'Cuando se activo el plan actual. NULL para free por default.';

COMMENT ON COLUMN auth.users.plan_expires_at IS
  'Fecha de expiracion del plan pagado. NULL = perpetuo (admin manual) o '
  'plan free. Cron diario (futuro V171) downgradea a free si NOW() > expires.';

COMMENT ON COLUMN auth.users.plan_changed_at IS
  'Timestamp del ultimo cambio de plan. Se actualiza junto con plan_changed_by.';

COMMENT ON COLUMN auth.users.plan_changed_by IS
  'Admin (auth.users.id) que ejecuto el ultimo cambio de plan. Auditoria.';

COMMENT ON COLUMN auth.users.plan_notes IS
  'Notas libres del admin sobre este suscriptor: metodo de pago, contacto, '
  'razon del downgrade, etc. Solo visible en panel /admin/suscripciones.';

-- ---------- Indices para queries del panel ----------
CREATE INDEX IF NOT EXISTS idx_users_last_login_at
  ON auth.users (last_login_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_users_plan_expires_at
  ON auth.users (plan_expires_at)
  WHERE plan_expires_at IS NOT NULL;

-- ---------- Trigger last_login_at ----------
CREATE OR REPLACE FUNCTION auth.fn_touch_last_login()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only bump si es una session nueva (INSERT). Better Auth refresca
  -- sesiones actualizando updated_at pero eso NO cuenta como login nuevo.
  UPDATE auth.users
     SET last_login_at = NEW.created_at
   WHERE id = NEW.user_id
     AND (last_login_at IS NULL OR NEW.created_at > last_login_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_touch_last_login ON auth.sessions;
CREATE TRIGGER trg_sessions_touch_last_login
  AFTER INSERT ON auth.sessions
  FOR EACH ROW
  EXECUTE FUNCTION auth.fn_touch_last_login();

-- ---------- Backfill last_login_at desde sesiones existentes ----------
-- One-shot: para users que ya tienen sesiones creadas, poblar el timestamp.
-- Idempotente por WHERE last_login_at IS NULL.
UPDATE auth.users u
   SET last_login_at = s.max_created
  FROM (
    SELECT user_id, MAX(created_at) AS max_created
      FROM auth.sessions
     GROUP BY user_id
  ) s
 WHERE u.id = s.user_id
   AND u.last_login_at IS NULL;
