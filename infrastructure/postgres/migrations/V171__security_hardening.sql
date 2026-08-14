-- =========================================================================
-- V171 — Endurecimiento de seguridad pre-lanzamiento comercial
-- =========================================================================
--
-- Contexto (audit dea 2026-08-14): la app es scrapeable en 48h por $9 si
-- no aplicamos estas defensas:
--   1. Rate limit API solo por minuto (60/min * 60 * 24 = 86.4k/dia) →
--      alcanza para descargar todo el universo SBS.
--   2. `.edu.pe` auto-asigna Academic sin verificar que el dominio sea
--      universidad real → attacker crea x@fake.edu.pe y consigue API.
--   3. Signup sin rate limit por IP → script crea 10k cuentas en minutos.
--
-- V171 mitiga (1) y (2). (3) se implementa en app-level.
--
-- Idempotente. Backward compatible con V167/V168/V169.
-- =========================================================================

-- ------------------------------------------------------------------------
-- CAPA 1 — Rate limit DIARIO en API keys (complementa el rolling minuto)
-- ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.api_key_daily_usage (
  api_key_id   UUID        NOT NULL REFERENCES auth.api_keys(id) ON DELETE CASCADE,
  usage_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER    NOT NULL DEFAULT 0,
  first_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_api_key_daily_usage_date
  ON auth.api_key_daily_usage (usage_date DESC);

COMMENT ON TABLE auth.api_key_daily_usage IS
  'Contador diario de requests por API key. Complementa el rate limit '
  'por minuto (rolling 60s desde auth.api_key_requests) con un cap diario '
  'que evita scraping masivo. Ejemplo: 60 req/min * 60 * 24 = 86400 req/dia '
  'era suficiente para descargar todo el universo SBS en 2 dias. El cap '
  'diario reduce este vector a 500/dia (academic) = 6+ meses para el mismo '
  'volumen (tiempo suficiente para detectar y bloquear).';

-- Retencion: 30 dias es suficiente para auditoria + graficas de uso en UI.
-- Cron opcional (futuro): DELETE WHERE usage_date < CURRENT_DATE - 30.

-- ------------------------------------------------------------------------
-- CAPA 2 — Whitelist de dominios .edu.pe legitimos
-- ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.academic_domain_whitelist (
  domain          TEXT PRIMARY KEY,
  institution     TEXT NOT NULL,
  notes           TEXT,
  approved_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE auth.academic_domain_whitelist IS
  'Universidades peruanas verificadas cuyos emails .edu.pe activan '
  'automaticamente plan Academic. Otros dominios .edu.pe requieren '
  'aprobacion manual admin (via /dashboard/admin/access-requests). '
  'Fuente: SUNEDU + verificacion manual de MX records.';

-- Seed con top-20 universidades peruanas activas (SUNEDU-licenciadas).
-- Lista curada. Ampliar via admin panel cuando aparezcan tesistas de
-- universidades no listadas — no bloquear, solo obligar approval manual.
INSERT INTO auth.academic_domain_whitelist (domain, institution) VALUES
  ('pucp.edu.pe',      'Pontificia Universidad Católica del Perú'),
  ('unmsm.edu.pe',     'Universidad Nacional Mayor de San Marcos'),
  ('up.edu.pe',        'Universidad del Pacífico'),
  ('ulima.edu.pe',     'Universidad de Lima'),
  ('uni.edu.pe',       'Universidad Nacional de Ingeniería'),
  ('upc.edu.pe',       'Universidad Peruana de Ciencias Aplicadas'),
  ('usil.edu.pe',      'Universidad San Ignacio de Loyola'),
  ('esan.edu.pe',      'Universidad ESAN'),
  ('unsa.edu.pe',      'Universidad Nacional de San Agustín (Arequipa)'),
  ('ucsp.edu.pe',      'Universidad Católica San Pablo (Arequipa)'),
  ('ucsm.edu.pe',      'Universidad Católica de Santa María (Arequipa)'),
  ('utp.edu.pe',       'Universidad Tecnológica del Perú'),
  ('cientifica.edu.pe','Universidad Científica del Sur'),
  ('upn.edu.pe',       'Universidad Privada del Norte'),
  ('urp.edu.pe',       'Universidad Ricardo Palma'),
  ('unife.edu.pe',     'Universidad Femenina del Sagrado Corazón'),
  ('usmp.edu.pe',      'Universidad San Martín de Porres'),
  ('unt.edu.pe',       'Universidad Nacional de Trujillo'),
  ('unp.edu.pe',       'Universidad Nacional de Piura'),
  ('unica.edu.pe',     'Universidad Nacional San Luis Gonzaga de Ica')
ON CONFLICT (domain) DO NOTHING;

-- ------------------------------------------------------------------------
-- CAPA 3 — Trigger V168 endurecido: solo whitelist activa Academic
-- ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.fn_detect_academic_email()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_domain TEXT;
  v_is_whitelisted BOOLEAN;
BEGIN
  -- Solo aplica en INSERT (nuevo user) o si email cambio.
  IF TG_OP = 'UPDATE' AND OLD.email = NEW.email THEN
    RETURN NEW;
  END IF;

  -- Extraer dominio del email (parte despues del @).
  v_domain := lower(split_part(NEW.email, '@', 2));

  -- Solo procesar dominios .edu.pe.
  IF v_domain !~ '\.edu\.pe$' THEN
    RETURN NEW;
  END IF;

  -- V171: solo whitelist activa auto-Academic. Otros .edu.pe quedan Free
  -- hasta aprobacion manual admin. Esto bloquea el vector "fake.edu.pe"
  -- donde attacker inventa dominio inexistente para obtener API access.
  SELECT EXISTS (
    SELECT 1 FROM auth.academic_domain_whitelist WHERE domain = v_domain
  ) INTO v_is_whitelisted;

  IF v_is_whitelisted THEN
    NEW.plan := 'academic';
    NEW.academic_verified_at := now();
    NEW.plan_started_at := COALESCE(NEW.plan_started_at, now());
  END IF;
  -- Si el dominio NO esta en whitelist, el user queda con plan default
  -- (free). Un admin puede revisar el email y promoverlo manualmente
  -- desde /dashboard/admin/suscripciones si valida que es institucion
  -- legitima. Zero fricción para los 20 dominios legit; friccion para
  -- attackers que inventan fake.edu.pe.
  RETURN NEW;
END;
$$;

-- Recrear trigger para que use la funcion V171. DROP + CREATE para
-- asegurar reemplazo aun si la firma cambio.
DROP TRIGGER IF EXISTS trg_detect_academic_email ON auth.users;
CREATE TRIGGER trg_detect_academic_email
  BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.fn_detect_academic_email();

-- ------------------------------------------------------------------------
-- CAPA 4 — Backfill defensivo: revocar Academic a users con dominio no-whitelist
-- ------------------------------------------------------------------------
-- Users existentes que hayan conseguido academic con un dominio no-whitelist
-- (probablemente nadie hoy, pero por defensa) son downgradeados a free.
-- Admin puede promoverlos manualmente si son legitimos.

UPDATE auth.users u
   SET plan = 'free',
       academic_verified_at = NULL,
       plan_notes = COALESCE(u.plan_notes || E'\n', '') ||
         '[V171 downgrade] Dominio no en whitelist. Verificar manualmente si es legitimo.'
 WHERE u.plan = 'academic'
   AND u.email ~* '\.edu\.pe$'
   AND lower(split_part(u.email, '@', 2)) NOT IN (
     SELECT domain FROM auth.academic_domain_whitelist
   );

-- ------------------------------------------------------------------------
-- CAPA 5 — Rate limit signup por IP
-- ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.signup_attempts (
  ip_address   INET        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email        TEXT,
  succeeded    BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_ip_time
  ON auth.signup_attempts (ip_address, attempted_at DESC);

COMMENT ON TABLE auth.signup_attempts IS
  'Rate limit por IP en signup. Guarda intento (aunque falle) para poder '
  'contar los ultimos 60 min por IP. Purga automatica: filas >48h se '
  'pueden eliminar con cron opcional.';

-- Vista helper: intentos recientes por IP (ultimos 60 min).
CREATE OR REPLACE VIEW auth.v_signup_recent_by_ip AS
  SELECT
    ip_address,
    COUNT(*)::int          AS attempts_last_60min,
    MAX(attempted_at)      AS last_attempt,
    array_agg(DISTINCT email) FILTER (WHERE email IS NOT NULL) AS emails
  FROM auth.signup_attempts
 WHERE attempted_at >= now() - interval '60 minutes'
 GROUP BY ip_address;

COMMENT ON VIEW auth.v_signup_recent_by_ip IS
  'Panel-friendly view: cuantos intentos hubo por IP en los ultimos 60 min. '
  'Usar en /dashboard/admin para detectar mass-signup attacks.';
