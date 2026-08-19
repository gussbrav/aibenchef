-- =========================================================================
-- V174 — Trial 14 dias SIN excepciones: todos al mismo saco
-- =========================================================================
--
-- Contexto: V173 introdujo un skip para `academic_verified_at IS NOT NULL`
-- (users con email .edu.pe de universidad whitelist iban directo a plan
-- 'free' sin trial). Feedback comercial 2026-08-18: "todos entran al mismo
-- saco, no quiero sorpresas, alinealo". Todos los signups nuevos deben
-- recibir la misma experiencia: trial 14 dias con features Pro.
--
-- Rationale de negocio:
--   - Consistencia en el messaging: "empezas con 14 dias de prueba" aplica
--     a TODOS, sin importar el email.
--   - Elimina la "sorpresa" (positiva o negativa) para el tesista peruano
--     que ve un chip especifico al signup.
--   - Simplifica soporte: un solo flujo, un solo cuento comercial.
--
-- Que se conserva (por si se necesita en el futuro):
--   - Enum user_plan.academic (para admin manual assignment)
--   - PLAN_LIMITS.academic en el codigo (features definidas)
--   - Tabla auth.academic_domain_whitelist (data no se pierde)
--   - Columna auth.users.academic_verified_at (data no se pierde)
--   - Trigger auth.fn_mark_academic_verified (sigue marcando el timestamp)
--
-- Solo cambia: start_trial() ya NO usa academic_verified_at como gate.
-- Si en el futuro se quiere reintroducir descuento academic, se hace via
-- admin manual desde /dashboard/admin/suscripciones (mismo flujo pagado).
--
-- Idempotente (CREATE OR REPLACE FUNCTION).
-- =========================================================================

CREATE OR REPLACE FUNCTION auth.start_trial(p_user_id UUID)
RETURNS TABLE (started BOOLEAN, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_plan TEXT;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- Snapshot del user
  SELECT plan::text, created_at
    INTO v_current_plan, v_created_at
    FROM auth.users
   WHERE id = p_user_id;

  IF v_current_plan IS NULL THEN
    RETURN QUERY SELECT false, 'user_not_found'::TEXT;
    RETURN;
  END IF;

  -- V174: eliminado el skip por academic_verified_at. Todos entran al
  -- mismo trial. Si alguien es tesista con .edu.pe verificado, igual
  -- recibe los 14 dias. El descuento academic (S/29) se otorga solo si
  -- pagan — via admin manual desde /dashboard/admin/suscripciones.

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

  -- Iniciar trial: plan='trial', expira en 14 dias.
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
  'V174: inicia trial de 14 dias para CUALQUIER user recien registrado. '
  'Sin excepciones — todos al mismo saco (feedback comercial: alinear '
  'mensaje, cero sorpresas). Skipea users viejos (>5min). Si un tesista '
  '.edu.pe quiere el descuento S/29 mensual, admin lo promueve manual '
  'desde /dashboard/admin/suscripciones tras confirmar pago.';
