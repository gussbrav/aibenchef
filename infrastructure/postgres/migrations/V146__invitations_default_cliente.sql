-- V146 — Pre-cargar cliente default en la invitacion.
--
-- Contexto: cuando el admin invita a un CFO/analista de un cliente
-- especifico, quiere que ya venga configurado con "su" cliente para que
-- entre al Benchmark y aterrice directo — sin tener que ir a Mi perfil
-- a elegirlo primero.
--
-- Esta columna es opcional. Si NULL, el usuario aterrizara en el default
-- global (BCP) al aceptar, y puede configurarlo despues desde el perfil.
--
-- El slug se valida en application code (createInvitation) contra
-- config.cliente.activo. Al aceptar la invitacion (acceptInvitation),
-- se copia a auth.users.default_cliente_slug.
--
-- Idempotente.

ALTER TABLE app.invitations
  ADD COLUMN IF NOT EXISTS default_cliente_slug text;

COMMENT ON COLUMN app.invitations.default_cliente_slug IS
  'Cliente que se copia a auth.users.default_cliente_slug al aceptar la invitacion. Permite que el admin pre-configure el landing del invitado. Opcional.';
