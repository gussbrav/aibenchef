-- V145 — Preferencia de cliente default por usuario.
--
-- Contexto: aibenchef es una herramienta de consulta abierta — cualquier
-- role=usuario puede navegar a cualquier cliente via ?cliente=X. Sin
-- restriccion. Pero UX-wise, cuando un usuario entra al informe queremos
-- que aterrice en SU cliente sin tener que tipear la URL a mano.
--
-- Esta migracion agrega la columna default_cliente_slug a auth.users.
-- El slug se valida en application code contra config.cliente.slug al
-- guardarlo (no ponemos FK porque config.cliente puede pisarse en
-- refresh de renombres/branding y no queremos cascade delete de usuarios).
--
-- Idempotente.

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS default_cliente_slug text;

COMMENT ON COLUMN auth.users.default_cliente_slug IS
  'Slug del cliente que el usuario ve por defecto al entrar al informe. NULL = fallback global. Se valida en app code contra config.cliente.';
