-- =========================================================================
-- V167 — Plans (Free/Pro/Business) por usuario
-- =========================================================================
--
-- Contexto: al abrir el signup self-serve (2026-08-12), todo user nuevo
-- necesita un "plan" para saber que features tiene disponibles. Por default
-- se asigna 'free' con limites conservadores; upgrade a pro/business
-- requiere flujo de pago (Stripe/Culqi — siguiente iteracion).
--
-- Limites por plan (documentados en apps/web/lib/plans.ts):
--   free:     1 entidad propia · 2 peers · 12m historico · sin PDF · 1 pub/mes
--   pro:      1 entidad · 10 peers · 60m · PDF · 20 pub/mes · insights AI
--   business: ilimitado + API + SLA + white-label
--
-- Idempotente. Backward compatible (users existentes quedan en 'free').
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_plan') THEN
    CREATE TYPE user_plan AS ENUM ('free', 'pro', 'business');
  END IF;
END$$;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS plan user_plan NOT NULL DEFAULT 'free';

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_plan ON auth.users (plan);

COMMENT ON COLUMN auth.users.plan IS
  'Plan comercial del usuario. free = default, sin costo, con limites. '
  'pro/business = pagos activos. Enforcement se hace server-side en cada '
  'API endpoint que valida limites (ver apps/web/lib/plans.ts).';

COMMENT ON COLUMN auth.users.onboarded_at IS
  'Timestamp del primer login exitoso donde el user completo el tour de '
  'onboarding. NULL = onboarding pendiente (mostrar modal welcome).';
