-- =========================================================================
-- V045: System settings key-value para config global (no per-tenant)
--
-- Casos de uso:
--  - Resend API key + from email (envio de invitaciones)
--  - Webhooks / integraciones futuras
--  - Feature flags globales
--
-- NO confundir con dw.app_settings (config per-tenant que no existe aun).
-- =========================================================================

CREATE TABLE IF NOT EXISTS app.system_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT,                              -- plaintext o ciphertext
    is_secret       BOOLEAN NOT NULL DEFAULT false,    -- si true, value esta encriptado con AES-256-GCM
    descripcion     TEXT,
    updated_by      TEXT,                              -- email del admin que lo actualizo
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.system_settings IS
    'Key-value de configuracion global de la app. Para secrets, value se '
    'guarda encriptado con AES-256-GCM (la clave APP_ENCRYPTION_KEY ya existente).';

-- Seeds: las claves esperadas (sin value, las setea el admin desde UI)
INSERT INTO app.system_settings (key, value, is_secret, descripcion) VALUES
    ('email_resend_api_key', NULL, TRUE,
     'API key de Resend (https://resend.com) para envio automatico de invitaciones. Si esta vacio, se muestra link copiable manual.'),
    ('email_resend_from', NULL, FALSE,
     'Email "from" de las invitaciones. Debe estar verificado en Resend. Ej: invitaciones@tu-dominio.com'),
    ('email_resend_enabled', 'false', FALSE,
     'Habilitar envio automatico de email via Resend. true/false.')
ON CONFLICT (key) DO NOTHING;
