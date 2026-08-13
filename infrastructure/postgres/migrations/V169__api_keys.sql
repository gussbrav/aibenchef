-- =========================================================================
-- V169 — API keys para consumo programatico de la API publica
-- =========================================================================
--
-- Contexto: al abrir el segmento tesistas (V168) y el plan Academico con
-- apiAccess=true, necesitamos que los users generen keys para autenticar
-- sus requests a /api/public/v1/*. Tambien Pro y Business tienen
-- apiAccess=true para clientes que quieran automatizar reportes.
--
-- Modelo:
--   - Cada key pertenece a un user (owner). Cascade delete: si el user se
--     borra, todas sus keys se van con el.
--   - El TOKEN COMPLETO nunca se guarda — solo su hash (SHA-256). El user
--     ve el token en clear UNA SOLA VEZ al crearlo; despues solo puede
--     verlo "aibchf_xxxxxxxx...ultima4" (prefix + last4).
--   - Revoked es soft-delete via columna revoked_at (permite auditar keys
--     que fueron revocadas y cuando).
--   - last_used_at se actualiza async cuando la key se usa (opcional,
--     util para UI "no usada en 90 dias -> considera borrarla").
--   - name libre elegido por el user ("Mi laptop", "Servidor tesis", etc)
--     para distinguir en la UI.
--
-- Formato del token: aibchf_<32 bytes base64url>
--   - aibchf_ prefix ayuda a identificar en logs/leaks (leak scanners como
--     GitGuardian pueden matchear el patron y alertar)
--   - 32 bytes = ~256 bits entropy, alcanza y sobra
--   - base64url (no +/=) para que sea URL-safe sin escapar
--
-- Rate limits (enforceados en app-level, no en DB):
--   - academic: 60 req/min
--   - pro: 300 req/min
--   - business: 600 req/min
--
-- Idempotente.
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Nombre libre elegido por el user para distinguir keys en la UI.
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),

  -- Prefix visible + last4 del token en clear. Nunca el token completo.
  -- Ejemplo: prefix='aibchf_x9K4', last4='pQm2'. Sirve para mostrar
  -- "aibchf_x9K4...pQm2" sin exponer nada usable.
  prefix TEXT NOT NULL,
  last4 TEXT NOT NULL,

  -- SHA-256 hex del token completo. 64 chars. Con este hasheado + el
  -- token del request, comparamos (constant-time) para autenticar.
  token_hash TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,

  -- Note opcional del user (ej: "Solo lectura", "Migrar a MCP", etc)
  note TEXT
);

COMMENT ON TABLE auth.api_keys IS
  'API keys para consumo programatico de /api/public/v1/*. El token '
  'completo nunca se guarda — solo su SHA-256. V169.';

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
  ON auth.api_keys (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_token_hash
  ON auth.api_keys (token_hash)
  WHERE revoked_at IS NULL;

-- Tabla auxiliar para rate limiting simple in-DB (fallback si no hay
-- Redis). Rolling window por minuto. Los inserts van con TTL de 1h para
-- auto-limpieza via job periodico.
CREATE TABLE IF NOT EXISTS auth.api_key_requests (
  api_key_id UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE CASCADE,
  ts_minute TIMESTAMPTZ NOT NULL, -- date_trunc('minute', now())
  count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (api_key_id, ts_minute)
);

COMMENT ON TABLE auth.api_key_requests IS
  'Rolling counter por API key + minuto para rate limiting. Se limpia con '
  'job periodico (borrar registros con ts_minute < now() - 2 hours). V169.';

-- Trigger para actualizar last_used_at cuando llega un request. Se
-- llama desde el middleware app-level DESPUES de validar la key (para
-- no gastar UPDATE si el token es invalido).
CREATE OR REPLACE FUNCTION auth.record_api_key_usage(p_api_key_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_minute TIMESTAMPTZ := date_trunc('minute', now());
BEGIN
  -- 1. Bump del contador rolling.
  INSERT INTO auth.api_key_requests (api_key_id, ts_minute, count)
  VALUES (p_api_key_id, v_minute, 1)
  ON CONFLICT (api_key_id, ts_minute)
  DO UPDATE SET count = auth.api_key_requests.count + 1;

  -- 2. Update last_used_at (best-effort, no bloquea si contention).
  UPDATE auth.api_keys
     SET last_used_at = now()
   WHERE id = p_api_key_id
     AND (last_used_at IS NULL OR last_used_at < now() - interval '10 seconds');
END;
$$;

COMMENT ON FUNCTION auth.record_api_key_usage(UUID) IS
  'Registra 1 request en la ventana del minuto actual + refresca '
  'last_used_at (throttled a 1x cada 10s para no thrashear la tabla). V169.';

-- Helper: count de requests en la ventana de ultimo minuto para una key.
CREATE OR REPLACE FUNCTION auth.count_api_key_requests_last_minute(p_api_key_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(count), 0)::int
    FROM auth.api_key_requests
   WHERE api_key_id = p_api_key_id
     AND ts_minute >= date_trunc('minute', now()) - interval '1 minute';
$$;

COMMENT ON FUNCTION auth.count_api_key_requests_last_minute(UUID) IS
  'Suma requests de una API key en los ultimos 60 segundos (rolling). '
  'Usado por el middleware de rate limiting. V169.';
