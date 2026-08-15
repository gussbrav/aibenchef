-- =========================================================================
-- V172 — Plan Academic pasa a ser SOLO por pago (no auto-asignado)
-- =========================================================================
--
-- Contexto: V168 introdujo auto-asignacion de plan='academic' via trigger
-- cuando el email era .edu.pe. V171 endurecio esto con whitelist. Pero
-- ambas versiones tenian el mismo problema estructural: entregaban las
-- features del plan Academic (5 años historico, 5 peers, PDF/Excel, API,
-- MCP) SIN CONTRAPRESTACION ECONOMICA. Cualquier persona con email
-- @pucp.edu.pe (o cualquier universidad whitelist) accedia gratis a lo
-- que en el pricing publico se anuncia como S/29/mes.
--
-- Riesgo: si el trigger sigue activo, todos los tesistas peruanos
-- (~50k+ estudiantes de negocios/economia) pueden crear cuenta y usar
-- Academic gratis. Regalamos el producto y matamos la conversion.
--
-- Fix V172:
--   1. DROP trigger fn_detect_academic_email (no mas auto-Academic)
--   2. Downgrade a free todos los users que hoy estan en academic sin
--      registro de pago (plan_started_at es la unica evidencia; si es
--      NULL o si plan_notes no menciona pago, downgrade).
--   3. La whitelist se mantiene — se usa como MARKER para descuento
--      futuro en pricing UI ("hey, eres tesista verificado, tu Academic
--      cuesta S/29 en lugar de S/149") pero NO da features gratis.
--   4. `academic_verified_at` se mantiene como marker informacional para
--      el admin (util para saber "este user es estudiante real de PUCP").
--
-- Idempotente. Reversible via admin panel (`/dashboard/admin/suscripciones`
-- permite re-promover manualmente si el user paga).
-- =========================================================================

-- ------------------------------------------------------------------------
-- CAPA 1 — Remover el trigger de auto-Academic
-- ------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_detect_academic_email ON auth.users;
DROP FUNCTION IF EXISTS auth.fn_detect_academic_email();

COMMENT ON TABLE auth.academic_domain_whitelist IS
  'V172: whitelist ya NO auto-activa el plan Academic. Se conserva como '
  'marker informacional: al signup con email de whitelist, el sistema '
  'poblará academic_verified_at pero el plan queda free hasta pago '
  'manual (S/29/mes via WhatsApp). Rationale V172: no regalar features.';

-- ------------------------------------------------------------------------
-- CAPA 2 — Trigger NUEVO: solo marca `academic_verified_at` (sin plan)
-- ------------------------------------------------------------------------
-- Un tesista con email .edu.pe whitelist queda registrado como "verificado"
-- pero su plan sigue free. El marker sirve para:
--   - Panel admin (mostrar badge "verified student" en /admin/suscripciones)
--   - Futuro pricing dinamico (mostrar S/29 en ContratarPlanModal si
--     verified_at != null)
--   - Analytics (medir conversion tesista → pagado)

CREATE OR REPLACE FUNCTION auth.fn_mark_academic_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_domain TEXT;
  v_is_whitelisted BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.email = NEW.email THEN
    RETURN NEW;
  END IF;

  v_domain := lower(split_part(NEW.email, '@', 2));

  IF v_domain !~ '\.edu\.pe$' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM auth.academic_domain_whitelist WHERE domain = v_domain
  ) INTO v_is_whitelisted;

  IF v_is_whitelisted THEN
    -- SOLO marker. El plan NO se toca (queda free hasta que un admin lo
    -- promueva a academic manualmente al confirmar pago S/29).
    NEW.academic_verified_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mark_academic_verified
  BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.fn_mark_academic_verified();

-- ------------------------------------------------------------------------
-- CAPA 3 — Backfill: downgrade academic no-pagados a free
-- ------------------------------------------------------------------------
-- Regla: si un user esta en academic pero plan_notes NO menciona "pago" y
-- plan_changed_by es NULL (nunca lo cambio un admin manualmente) →
-- probablemente fue auto-asignado por V168/V171 → downgrade a free.
--
-- Users que un admin promovio manualmente (plan_changed_by IS NOT NULL) se
-- conservan — asumimos pago verificado por el admin.

UPDATE auth.users u
   SET plan = 'free',
       plan_notes = COALESCE(u.plan_notes || E'\n', '') ||
         '[V172] Downgrade automatico: plan Academic ya no se auto-asigna. ' ||
         'Si es tesista legit y quiere pagar S/29/mes, promover manualmente ' ||
         'desde /dashboard/admin/suscripciones tras confirmar pago.'
 WHERE u.plan = 'academic'
   AND u.plan_changed_by IS NULL
   AND (u.plan_notes IS NULL OR u.plan_notes !~* '(pago|paid|voucher|yape|transferencia)');
