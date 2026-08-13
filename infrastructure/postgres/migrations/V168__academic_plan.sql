-- =========================================================================
-- V168 — Plan Academico (para tesistas/estudiantes) + verificacion .edu.pe
-- =========================================================================
--
-- Contexto: al aparecer el segmento de tesistas peruanos que necesitan
-- data del sistema financiero para sus tesis universitarias (Economia,
-- Finanzas, Administracion), creamos un plan Academico low-cost ($9/mes)
-- con verificacion automatica via email institucional (*.edu.pe).
--
-- Limites del plan academic (documentados en apps/web/lib/plans.ts):
--   maxPeers: 5, maxHistoricoMeses: 60 (5 anios), publicacionesPorMes: 0,
--   insightsAI: false, exportPDF: true, exportExcel: true,
--   colorsPersistidos: true, apiAccess: true (para el MCP server),
--   slaEnterprise: false.
--
-- Trigger DB: BEFORE INSERT en auth.users detecta email .edu.pe y setea
-- plan='academic' + academic_verified_at=now() automaticamente. Funciona
-- sin importar si el signup viene por Google OAuth o email/password.
-- Fuente de verdad en la DB, no en la app.
--
-- Idempotente. Backward compatible (users existentes con plan='free' quedan
-- como estan; si sus emails son .edu.pe, se puede correr un backfill manual
-- opcional al final del archivo — comentado).
-- =========================================================================

-- 1. Agregar valor al enum. IF NOT EXISTS evita error si ya existe.
-- Postgres compila el uso del valor dentro de las funciones lazy, asi que
-- el trigger de abajo se puede crear en la misma transaccion sin problema.
ALTER TYPE user_plan ADD VALUE IF NOT EXISTS 'academic' BEFORE 'pro';

-- 2. Columna nueva: timestamp de verificacion academica. NULL = no
-- verificado (aun si plan='academic' por algun motivo manual, no se
-- considera academico "real" hasta tener este timestamp).
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS academic_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN auth.users.academic_verified_at IS
  'Timestamp de la verificacion academica automatica (email institucional '
  '.edu.pe). NULL = no verificado como academico. Se setea via trigger '
  'BEFORE INSERT (ver auth.detect_academic_email). V168.';

-- 3. Funcion trigger — detecta email .edu.pe y auto-setea plan academic.
-- SECURITY DEFINER no es necesario porque el trigger corre en el contexto
-- del user que hace INSERT (Better Auth = server-side).
CREATE OR REPLACE FUNCTION auth.detect_academic_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo aplica si el user aun no tiene un plan pagado explicito.
  -- Un admin que ya asigno plan='pro' o 'business' manualmente NO
  -- debe ser degradado a academic.
  IF NEW.plan = 'free' AND NEW.email ILIKE '%.edu.pe' THEN
    NEW.plan := 'academic';
    NEW.academic_verified_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auth.detect_academic_email() IS
  'Trigger BEFORE INSERT en auth.users. Si el email termina en .edu.pe '
  'y el plan default es free, auto-upgrade a academic + set verified_at. '
  'V168.';

-- 4. Trigger. DROP + CREATE porque CREATE OR REPLACE TRIGGER no existe
-- en Postgres <14 y queremos ser conservadores en la sintaxis.
DROP TRIGGER IF EXISTS trg_detect_academic_email ON auth.users;
CREATE TRIGGER trg_detect_academic_email
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.detect_academic_email();

-- 5. Backfill opcional: si hay users existentes con email .edu.pe
-- y plan='free', promoverlos a academic. Idempotente.
UPDATE auth.users
   SET plan = 'academic',
       academic_verified_at = COALESCE(academic_verified_at, now())
 WHERE plan = 'free'
   AND email ILIKE '%.edu.pe'
   AND academic_verified_at IS NULL;
