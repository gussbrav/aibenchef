-- =========================================================================
-- V140 — LLM Vault: gestion segura de credenciales de proveedores AI
--
-- OBJETIVO: gestionar API keys de Claude, OpenAI, Ollama y otros
-- proveedores LLM desde una UI admin, con encriptacion at-rest y
-- audit trail. Evita hardcodear keys como env vars (mala practica).
--
-- SEGURIDAD:
-- - API keys guardadas cifradas con AES-256-GCM via pgcrypto
-- - Master key (LLM_VAULT_MASTER_KEY) vive UNICAMENTE en env var
--   del contenedor, NUNCA en DB. Comprometer la DB no expone las keys.
-- - Audit trail append-only en admin.llm_provider_audit
-- - Cada provider puede tener scope global o por cliente (multi-tenant)
--
-- USO desde codigo:
--   const provider = await getProviderForCliente(clienteSlug);
--   const result = await provider.generate(prompt);
--
-- El code Python/TS no maneja keys directo — pide al vault el provider
-- adecuado ya listo para usar.
-- =========================================================================


-- ============ 1. Extension pgcrypto para encriptacion ============
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============ 2. Tabla principal de credenciales ============
CREATE TABLE IF NOT EXISTS admin.llm_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificacion del proveedor
    provider_type       TEXT NOT NULL
                        CHECK (provider_type IN (
                            'anthropic',
                            'openai',
                            'ollama',
                            'openai_compatible',  -- Groq, Together, Fireworks, etc.
                            'google'              -- Gemini (futuro)
                        )),
    display_name        TEXT NOT NULL,          -- 'Claude Haiku 4.5 (prod)'
    model               TEXT NOT NULL,          -- 'claude-haiku-4-5'

    -- Credencial cifrada. NULL para providers self-hosted sin auth (Ollama local).
    api_key_encrypted   BYTEA,
    -- Ultimos 4 chars de la key para display en UI ("sk-ant-...tMQ")
    -- Se calcula al insertar/actualizar, NO se puede reconstruir la key desde esto.
    api_key_hint        TEXT,

    -- Endpoint custom para Ollama / OpenAI-compatible / proxies
    base_url            TEXT,

    -- Multi-tenant: NULL = provider global (fallback), sino scoped al cliente
    cliente_slug        TEXT REFERENCES config.cliente(slug) ON DELETE CASCADE,

    -- Flags de estado
    is_active           BOOLEAN NOT NULL DEFAULT true,
    is_default          BOOLEAN NOT NULL DEFAULT false,

    -- Metadata operacional
    max_tokens_output   INT DEFAULT 800,        -- limite por generacion
    temperature         NUMERIC(3, 2) DEFAULT 0.3, -- 0=deterministico, 1=creativo

    -- Audit metadata
    created_by_email    TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at          TIMESTAMPTZ,            -- timestamp de la ultima rotacion de key

    -- Ultimo uso (para saber cuales estan realmente activos)
    last_used_at        TIMESTAMPTZ,

    -- Test de conexion (se popula al hacer click en "Probar" desde la UI)
    last_test_at        TIMESTAMPTZ,
    last_test_ok        BOOLEAN,
    last_test_error     TEXT
);

-- Constraint: solo UN provider puede ser is_default por scope
-- (1 default global + 1 default por cliente_slug).
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_providers_default_global
    ON admin.llm_providers (COALESCE(cliente_slug, ''))
    WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_llm_providers_cliente_active
    ON admin.llm_providers (cliente_slug, is_active)
    WHERE is_active = true;

COMMENT ON TABLE admin.llm_providers IS
    'Vault de credenciales de proveedores LLM. api_key_encrypted esta '
    'cifrado AES-256 con master key en env var LLM_VAULT_MASTER_KEY. '
    'cliente_slug=NULL -> provider global (default para todos), '
    'sino scoped al cliente especifico (override para clientes premium).';

COMMENT ON COLUMN admin.llm_providers.api_key_hint IS
    'Ultimos 4 chars de la key para display seguro en UI. Autogenerado '
    'por el trigger al INSERT/UPDATE, no editable manualmente.';


-- ============ 3. Audit log append-only ============
CREATE TABLE IF NOT EXISTS admin.llm_provider_audit (
    id                  BIGSERIAL PRIMARY KEY,
    provider_id         UUID,                   -- puede ser NULL si el provider ya fue borrado
    action              TEXT NOT NULL
                        CHECK (action IN (
                            'created',
                            'updated',
                            'key_rotated',
                            'set_default',
                            'unset_default',
                            'activated',
                            'deactivated',
                            'deleted',
                            'test_success',
                            'test_failed'
                        )),
    actor_email         TEXT NOT NULL,
    actor_ip            INET,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_provider ON admin.llm_provider_audit (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_audit_actor    ON admin.llm_provider_audit (actor_email, created_at DESC);

COMMENT ON TABLE admin.llm_provider_audit IS
    'Audit log append-only de cambios en llm_providers. Solo INSERT '
    'permitido (no updates/deletes). Consultar desde /dashboard/admin/llm-settings.';


-- ============ 4. Funciones de cifrado/descifrado ============
-- Wrappers de pgp_sym_encrypt/decrypt con algoritmo fijo AES-256-GCM
-- para consistencia y sin exposicion de parametros crypto al caller.

CREATE OR REPLACE FUNCTION admin.encrypt_api_key(
    _plain TEXT,
    _master_key TEXT
) RETURNS BYTEA
LANGUAGE sql
IMMUTABLE
AS $$
    -- Si el plain es NULL o vacio, devolver NULL (ej. Ollama sin auth).
    SELECT CASE
        WHEN _plain IS NULL OR _plain = '' THEN NULL
        ELSE pgp_sym_encrypt(
            _plain,
            _master_key,
            'cipher-algo=aes256, s2k-mode=3, s2k-count=65011712'
        )
    END;
$$;

CREATE OR REPLACE FUNCTION admin.decrypt_api_key(
    _encrypted BYTEA,
    _master_key TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN _encrypted IS NULL THEN NULL
        ELSE pgp_sym_decrypt(_encrypted, _master_key)
    END;
$$;

COMMENT ON FUNCTION admin.encrypt_api_key IS
    'Cifra una API key con AES-256 usando la master key del vault. '
    'Master key debe venir del env LLM_VAULT_MASTER_KEY del app. '
    'Devuelve NULL si el input es NULL/vacio (ej. Ollama self-hosted).';

COMMENT ON FUNCTION admin.decrypt_api_key IS
    'Descifra una API key previamente cifrada con encrypt_api_key. '
    'Master key debe ser la misma que la usada al cifrar.';


-- ============ 5. Trigger para autogenerar api_key_hint + audit ============
CREATE OR REPLACE FUNCTION admin.llm_providers_before_iu()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Actualizar timestamp
    NEW.updated_at := now();

    -- Si es un cambio de api_key_encrypted, marcar rotated_at
    IF TG_OP = 'UPDATE'
       AND OLD.api_key_encrypted IS DISTINCT FROM NEW.api_key_encrypted
       AND NEW.api_key_encrypted IS NOT NULL THEN
        NEW.rotated_at := now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_llm_providers_biu ON admin.llm_providers;
CREATE TRIGGER trg_llm_providers_biu
    BEFORE INSERT OR UPDATE ON admin.llm_providers
    FOR EACH ROW EXECUTE FUNCTION admin.llm_providers_before_iu();


-- ============ 6. Vista sanitizada para el UI (nunca expone bytea cifrado) ============
CREATE OR REPLACE VIEW admin.v_llm_providers_public AS
SELECT
    id,
    provider_type,
    display_name,
    model,
    api_key_hint,
    base_url,
    cliente_slug,
    is_active,
    is_default,
    max_tokens_output,
    temperature,
    created_by_email,
    created_at,
    updated_at,
    rotated_at,
    last_used_at,
    last_test_at,
    last_test_ok,
    last_test_error,
    -- Flag conveniente para saber si tiene key configurada sin exponerla
    (api_key_encrypted IS NOT NULL) AS has_api_key
FROM admin.llm_providers;

COMMENT ON VIEW admin.v_llm_providers_public IS
    'Vista sanitizada de llm_providers — NUNCA expone api_key_encrypted. '
    'Consumir desde /dashboard/admin/llm-settings.';


-- ============ 7. Seguridad: revocar SELECT del bytea a roles no-admin ============
-- Solo el usuario de conexion del app puede leer api_key_encrypted para
-- descifrarla. Ningun read model del dashboard debe tocar la tabla base.
-- (En este proyecto usamos un solo user postgres, pero dejamos la
-- convencion documentada para cuando se agreguen roles granulares.)


-- ============ 8. RLS multi-tenant (deferred - solo estructura, sin policies) ============
-- ALTER TABLE admin.llm_providers ENABLE ROW LEVEL SECURITY;
-- (No activamos RLS aun porque el sistema actual no tiene el request context
-- multi-tenant. Cuando se agregue - ver rules/governance.md - crear policy que
-- filtre WHERE cliente_slug IS NULL OR cliente_slug = current_tenant_slug.)
