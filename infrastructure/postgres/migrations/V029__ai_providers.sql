-- =========================================================================
-- V029: app.ai_providers — config de proveedores AI con keys encriptadas
--
-- Almacena api_keys de Claude, OpenAI, Ollama (y futuros) encriptadas con
-- AES-256-GCM. La clave maestra vive en env APP_ENCRYPTION_KEY (no en DB)
-- — si la perdes, los keys son irrecuperables, pero un DB dump leaked NO
-- expone los keys.
--
-- Formato api_key_encrypted: "iv:tag:ciphertext" (todos hex), separados por ':'.
-- Single-row por provider (config global, no per-user — el modulo Genie/etc
-- usa el provider activo, no es per-user).
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.ai_providers (
    provider          TEXT PRIMARY KEY CHECK (provider IN
                          ('claude', 'openai', 'ollama', 'gemini')),
    api_key_encrypted TEXT,            -- NULL si no esta configurado
    base_url          TEXT,            -- ej Ollama 'http://hetzner.host:11434'
    model_default     TEXT,            -- ej 'claude-opus-4-7'
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    notas             TEXT,            -- comentarios libres del operador
    last_updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_ai_providers_updated_at ON app.ai_providers;
CREATE TRIGGER tg_ai_providers_updated_at
    BEFORE UPDATE ON app.ai_providers
    FOR EACH ROW
    EXECUTE FUNCTION app.touch_updated_at();

COMMENT ON TABLE app.ai_providers IS
    'Config de proveedores AI. api_key_encrypted usa AES-256-GCM con clave '
    'maestra en env APP_ENCRYPTION_KEY (no en DB).';

-- Seed: registros stub para los 4 proveedores soportados (sin keys)
INSERT INTO app.ai_providers (provider, model_default, enabled, base_url, notas)
VALUES
    ('claude', 'claude-opus-4-7', TRUE,  NULL, 'Anthropic Claude API'),
    ('openai', 'gpt-4o',          FALSE, NULL, 'OpenAI GPT'),
    ('ollama', 'llama3.1:8b',     FALSE, 'http://localhost:11434', 'Self-hosted Ollama (Hetzner)'),
    ('gemini', 'gemini-2.0-flash',FALSE, NULL, 'Google Gemini API')
ON CONFLICT (provider) DO NOTHING;

-- =========================================================================
-- Audit log de cambios (para compliance)
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.ai_providers_audit (
    id            BIGSERIAL PRIMARY KEY,
    provider      TEXT NOT NULL,
    accion        TEXT NOT NULL CHECK (accion IN ('update_key', 'update_url', 'update_model', 'toggle_enabled', 'create', 'delete')),
    detalle       TEXT,
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_audit_provider
    ON app.ai_providers_audit (provider, created_at DESC);
