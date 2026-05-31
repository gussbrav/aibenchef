-- =========================================================================
-- V121: SMTP nativo como alternativa a Resend para envio de invitaciones.
--
-- MOTIVACION:
--   Resend requiere verificar dominio (DNS) y crea fricción para el operador
--   que ya tiene un Gmail/Zoho/Outlook funcional. Para Aibenchef self-hosted
--   queremos que pueda meter sus credenciales SMTP directas y mandar mail
--   sin pasar por un proveedor extra. El patron viene del CRM Palma Rio
--   donde ya funciona con gmail (smtp.gmail.com:587 + app password).
--
-- PRIORIDAD EN sendEmail():
--   1. SMTP si smtp_enabled = true            (gmail/zoho/cualquiera)
--   2. Resend si email_resend_enabled = true  (legacy, sigue funcionando)
--   3. Fallback: link copiable manual
--
-- Las contraseñas se cifran como cualquier otro secret (AES-256-GCM con
-- APP_ENCRYPTION_KEY) reusando la misma logica de system_settings.
-- =========================================================================

INSERT INTO app.system_settings (key, value, is_secret, descripcion) VALUES
    ('smtp_enabled', 'false', FALSE,
     'Habilitar envio de email via SMTP nativo (Gmail/Zoho/Outlook/etc). Si esta en true, tiene prioridad sobre Resend.'),
    ('smtp_host', NULL, FALSE,
     'Host SMTP. Ej: smtp.gmail.com (Gmail), smtppro.zoho.com (Zoho), smtp.office365.com (Outlook).'),
    ('smtp_port', '587', FALSE,
     'Puerto SMTP. 587 (TLS/STARTTLS, recomendado) o 465 (SSL). Casi nunca 25.'),
    ('smtp_secure', 'false', FALSE,
     'true para SSL directo (puerto 465). false para STARTTLS (puerto 587, lo mas comun).'),
    ('smtp_user', NULL, FALSE,
     'Usuario SMTP (normalmente tu email completo, ej tu@gmail.com).'),
    ('smtp_password', NULL, TRUE,
     'Contraseña SMTP. Para Gmail: app password de 16 chars (https://myaccount.google.com/apppasswords) — NO la contraseña de tu cuenta.'),
    ('smtp_from', NULL, FALSE,
     'Email "from" de las invitaciones. Para Gmail debe coincidir con smtp_user. Ej: "Aibenchef <tu@gmail.com>".')
ON CONFLICT (key) DO NOTHING;
