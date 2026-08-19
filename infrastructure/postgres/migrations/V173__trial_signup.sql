-- =========================================================================
-- V173 — Agregar 'trial' al enum user_plan (SOLO esto)
-- =========================================================================
--
-- IMPORTANTE: esta migration hace UNICAMENTE `ALTER TYPE ... ADD VALUE`.
--
-- PostgreSQL prohibe USAR un nuevo enum value en la MISMA transaccion en
-- que se agrego ("unsafe use of new value"). Como el migrator envuelve
-- cada archivo .sql en `sql.begin()`, si esta migration tambien creara
-- funciones/vistas que referencian 'trial' (ej. `WHERE plan = 'trial'`
-- en una VIEW, que compila eager), PostgreSQL rechaza toda la
-- transaccion y aborta el startup del web container.
--
-- Por eso el resto del setup (funciones auth.start_trial, auth.expire_trials,
-- vista auth.v_active_trials) esta separado en V174 (start_trial) y V179
-- (expire_trials + v_active_trials). Cada una corre en su propia txn con
-- 'trial' ya commiteado a nivel de tipo.
--
-- Split hecho en 2026-08-19 tras diagnostico del deploy fallido
-- (fix commit: rescate migrations V173-V178 que no aplicaban).
--
-- Idempotente. Backward compatible.
-- =========================================================================

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
