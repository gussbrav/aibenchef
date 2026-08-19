-- =========================================================================
-- V179 — Helpers del trial que fueron split de V173 (expire + vista)
-- =========================================================================
--
-- Contexto: V173 original hacia ALTER TYPE ADD VALUE + CREATE VIEW en la
-- misma txn. PostgreSQL prohibe usar un nuevo enum value en la misma
-- transaccion en que se agrego, la VIEW compilaba eager y explotaba
-- el startup del web container ("unsafe use of new value 'trial'").
--
-- Fix (2026-08-19): V173 recortada a solo el ADD VALUE. V174 crea la
-- funcion auth.start_trial (LANGUAGE plpgsql compila el body lazy → OK).
-- Y esta V179 crea las OTRAS 2 piezas que originalmente estaban en V173
-- pero fallaban:
--   - auth.expire_trials()      -- funcion, plpgsql lazy compile
--   - auth.v_active_trials      -- VIEW (aca es donde explotaba V173)
--
-- Ya con 'trial' commiteado desde V173, esta migration puede referenciarlo
-- sin problemas.
--
-- Idempotente (CREATE OR REPLACE).
-- =========================================================================

-- ------------------------------------------------------------------------
-- Funcion para expirar trials vencidos (cron/script diario)
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
  'invoca desde script scripts/expire-plans.ts (cron diario o manual).';

-- ------------------------------------------------------------------------
-- Vista panel admin: trials activos con dias restantes
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
