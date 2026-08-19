-- =========================================================================
-- V173 — Trial de 14 dias al signup con features Pro (data-safe)
-- =========================================================================
--
-- Contexto: hasta hoy los nuevos users caian directo a plan='free' (2 peers,
-- 12 meses, sin export). Sin ver la salsa del producto (5 años, insights,
-- publicaciones), la conversion a pagado es cero.
--
-- Estrategia (patron SaaS B2B estandar tipo Notion/Linear/Superhuman):
--   - Todo signup nuevo entra con plan='trial' por 14 dias
--   - Trial expone features del dashboard PERO no las rutas de extraccion
--     (ver plans.ts: apiAccess=false, exportExcel=false — el activo es la
--     data procesada, no la regalamos por 14 dias)
--   - Al dia 15: cron/script auth.expire_trials() baja a plan='free'
--   - Sin tarjeta, sin auto-charge
--
-- Anti-abuso:
--   - email unique en auth.users (nativo Better Auth) → un email = un trial
--   - rate limit signup por IP 3/hora (V171)
--   - academic .edu.pe whitelist NO da trial (van directo a free,
--     se promueven a academic al pagar S/29)
--
-- Grandfathering: users existentes NO reciben trial (no eran candidatos
-- pero tampoco es justo cobrarles retroactivo). Su plan y datos intactos.
--
-- Idempotente. Backward compatible.
-- =========================================================================

-- ------------------------------------------------------------------------
-- CAPA 1 — Agregar 'trial' al enum user_plan
-- ------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'user_plan'::regtype AND enumlabel = 'trial'
  ) THEN
    ALTER TYPE user_plan ADD VALUE 'trial';
  END IF;
END $$;

COMMENT ON TYPE user_plan IS
  'Planes comerciales. trial = signup con features Pro por 14 dias sin '
  'rutas de extraccion (protege el activo). free = permanente limitado. '
  'academic = descuento tesista S/29 (whitelist .edu.pe). pro/business = '
  'planes pagados. Ver apps/web/lib/plans.ts para features por plan.';

-- ------------------------------------------------------------------------
-- CAPA 2 — Funcion para iniciar trial (llamada desde Better Auth hook)
-- ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.start_trial(p_user_id UUID)
RETURNS TABLE (started BOOLEAN, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_academic_verified TIMESTAMPTZ;
  v_current_plan TEXT;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- Snapshot del user
  SELECT plan::text, academic_verified_at, created_at
    INTO v_current_plan, v_academic_verified, v_created_at
    FROM auth.users
   WHERE id = p_user_id;

  IF v_current_plan IS NULL THEN
    RETURN QUERY SELECT false, 'user_not_found'::TEXT;
    RETURN;
  END IF;

  -- Si el user es academic verified (whitelist .edu.pe) NO recibe trial.
  -- Va directo a free y se promueve a academic (S/29) manual al pagar.
  IF v_academic_verified IS NOT NULL THEN
    RETURN QUERY SELECT false, 'academic_verified_no_trial'::TEXT;
    RETURN;
  END IF;

  -- Solo aplicar a users REALMENTE nuevos (creados en los ultimos 5 minutos).
  -- Previene que llamadas repetidas re-inicien trial de users viejos.
  IF v_created_at < now() - interval '5 minutes' THEN
    RETURN QUERY SELECT false, 'user_not_new'::TEXT;
    RETURN;
  END IF;

  -- Solo si esta en plan 'free' (default de Better Auth al insertar).
  -- Si ya fue promovido a otro plan por admin (edge case race), respetar.
  IF v_current_plan <> 'free' THEN
    RETURN QUERY SELECT false, ('plan_already_set:' || v_current_plan)::TEXT;
    RETURN;
  END IF;

  -- Iniciar trial: plan='trial', expira en 14 dias, marca en plan_notes
  -- para trazabilidad.
  UPDATE auth.users
     SET plan = 'trial',
         plan_started_at = now(),
         plan_expires_at = now() + interval '14 days',
         plan_notes = 'trial:signup@' || to_char(now(), 'YYYY-MM-DD HH24:MI')
   WHERE id = p_user_id;

  RETURN QUERY SELECT true, 'trial_started_14d'::TEXT;
END;
$$;

COMMENT ON FUNCTION auth.start_trial(UUID) IS
  'Inicia trial de 14 dias para un user recien registrado. Skipea users '
  'academicos verificados (van directo a free) y users viejos (>5min). '
  'Se llama desde Better Auth databaseHooks.user.create.after.';

-- ------------------------------------------------------------------------
-- CAPA 3 — Funcion para expirar trials vencidos (cron/script diario)
-- ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.expire_trials()
RETURNS TABLE (expired_count INT, sample_ids UUID[])
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
  v_ids UUID[];
BEGIN
  -- Selecciona users con trial vencido para downgrade
  WITH targets AS (
    SELECT id FROM auth.users
     WHERE plan = 'trial'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at < now()
    LIMIT 500  -- batch size defensivo
  ),
  updated AS (
    UPDATE auth.users u
       SET plan = 'free',
           plan_notes = COALESCE(u.plan_notes, '') ||
             E'\n[trial expired ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']'
      WHERE u.id IN (SELECT id FROM targets)
      RETURNING u.id
  )
  SELECT COUNT(*)::int, array_agg(id)
    INTO v_count, v_ids
    FROM updated;

  RETURN QUERY SELECT COALESCE(v_count, 0), COALESCE(v_ids, ARRAY[]::UUID[]);
END;
$$;

COMMENT ON FUNCTION auth.expire_trials() IS
  'Downgrade a plan=free todos los users con plan=trial cuyo plan_expires_at '
  'ya paso. Idempotente. Retorna count + sample_ids para logging. Se '
  'invoca desde script scripts/expire-trials.ts (cron diario o manual).';

-- ------------------------------------------------------------------------
-- CAPA 4 — Vista panel admin: trials activos con dias restantes
-- ------------------------------------------------------------------------

CREATE OR REPLACE VIEW auth.v_active_trials AS
  SELECT
    u.id,
    u.email,
    u.name,
    u.plan_started_at        AS started_at,
    u.plan_expires_at        AS expires_at,
    EXTRACT(DAY FROM (u.plan_expires_at - now()))::int AS days_remaining,
    u.last_login_at
  FROM auth.users u
 WHERE u.plan = 'trial'
   AND u.plan_expires_at > now()
 ORDER BY u.plan_expires_at ASC;

COMMENT ON VIEW auth.v_active_trials IS
  'Trials activos en tiempo real. Panel /dashboard/admin/suscripciones '
  'puede consultar esta vista para mostrar quien esta en trial y cuando '
  'expira. days_remaining puede ser negativo si el cron aun no corrio.';
