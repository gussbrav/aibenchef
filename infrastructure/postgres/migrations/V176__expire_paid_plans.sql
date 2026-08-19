-- =========================================================================
-- V176: Auto-downgrade de planes pagados vencidos (academic/pro/business).
--
-- Contexto: V173 introdujo auth.expire_trials() para bajar trials vencidos
-- a plan=free. Falta el mismo mecanismo para los planes pagados: si un
-- cliente Business/Pro/Academic tiene plan_expires_at seteado y ya paso,
-- hoy sigue con el plan (no hay renewal automatico + no hay auto-downgrade).
--
-- Diseno:
--   - Funcion separada de expire_trials (semantica distinta: trial es fin
--     natural, plan pagado es LAPSE de renovacion → mas ruidoso, con marker
--     explicito en plan_notes para follow-up de admin).
--   - Cubre academic, pro, business. NO cubre free (nada que bajar) ni
--     trial (ya tiene su funcion).
--   - Idempotente: users con plan_expires_at IS NULL (plan perpetuo setteado
--     por admin) se saltan. Batch 500 defensivo.
--   - Preserva plan_notes con marker "[plan_expired {prior_plan} YYYY-MM-DD]"
--     para que el panel /admin/suscripciones muestre historia legible.
--
-- Retorna: (expired_count, sample_ids, by_plan_json) para que el script
-- pueda loguear breakdown por plan.
-- =========================================================================

CREATE OR REPLACE FUNCTION auth.expire_paid_plans()
RETURNS TABLE (
  expired_count INT,
  sample_ids    UUID[],
  by_plan       JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
  v_ids   UUID[];
  v_by_plan JSONB;
BEGIN
  -- CTE staging: users elegibles + su plan previo. Batch defensivo.
  CREATE TEMP TABLE IF NOT EXISTS _expire_tmp (id UUID, prior_plan TEXT)
    ON COMMIT DROP;
  TRUNCATE _expire_tmp;

  INSERT INTO _expire_tmp (id, prior_plan)
    SELECT id, plan
      FROM auth.users
     WHERE plan IN ('academic', 'pro', 'business')
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at < now()
     LIMIT 500;

  UPDATE auth.users u
     SET plan            = 'free',
         plan_expires_at = NULL,
         plan_changed_at = now(),
         plan_notes = COALESCE(u.plan_notes, '') ||
           E'\n[plan_expired ' || t.prior_plan ||
           ' ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']'
    FROM _expire_tmp t
   WHERE u.id = t.id;

  SELECT COUNT(*)::int, array_agg(id)
    INTO v_count, v_ids
    FROM _expire_tmp;

  SELECT COALESCE(jsonb_object_agg(prior_plan, cnt), '{}'::jsonb)
    INTO v_by_plan
    FROM (
      SELECT prior_plan, COUNT(*)::int AS cnt
        FROM _expire_tmp
       GROUP BY prior_plan
    ) g;

  RETURN QUERY SELECT
    COALESCE(v_count, 0),
    COALESCE(v_ids, ARRAY[]::UUID[]),
    COALESCE(v_by_plan, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION auth.expire_paid_plans() IS
  'Downgrade a plan=free todos los users con plan pagado (academic/pro/business) '
  'cuyo plan_expires_at ya paso. Idempotente. Marca plan_notes con '
  '"[plan_expired <prior_plan> YYYY-MM-DD]" para trazabilidad. Se invoca desde '
  'scripts/expire-plans.ts junto con auth.expire_trials().';

-- Vista de admin: planes pagados que vencen en los proximos 30 dias.
-- Sirve para que Gustavo vea en /admin/suscripciones a quien contactar
-- para renovacion antes que caduque.
CREATE OR REPLACE VIEW auth.v_paid_plans_expiring_soon AS
  SELECT
    u.id,
    u.email,
    u.name,
    u.plan,
    u.plan_expires_at,
    u.plan_notes,
    EXTRACT(DAY FROM (u.plan_expires_at - now()))::int AS days_remaining,
    CASE
      WHEN u.plan_expires_at < now() THEN 'vencido'
      WHEN u.plan_expires_at < now() + INTERVAL '7 days' THEN 'urgente'
      WHEN u.plan_expires_at < now() + INTERVAL '30 days' THEN 'proximo'
      ELSE 'ok'
    END AS status
    FROM auth.users u
   WHERE u.plan IN ('academic', 'pro', 'business')
     AND u.plan_expires_at IS NOT NULL
     AND u.plan_expires_at < now() + INTERVAL '30 days'
   ORDER BY u.plan_expires_at ASC;

COMMENT ON VIEW auth.v_paid_plans_expiring_soon IS
  'Planes pagados que vencen en los proximos 30 dias (o ya vencieron). '
  'Sirve para follow-up de renovacion manual desde /admin/suscripciones.';
