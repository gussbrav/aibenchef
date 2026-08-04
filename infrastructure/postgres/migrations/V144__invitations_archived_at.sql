-- V144 — Soft-archive de invitaciones consumidas/expiradas/revocadas.
--
-- Contexto: la UI de settings > invitaciones muestra un historial de invitaciones
-- que ya cumplieron su ciclo (aceptadas, revocadas, expiradas). No las podemos
-- borrar por auditoria (necesitamos saber quien invito a quien y cuando), pero
-- si permitimos que el admin las "archive" — se ocultan del listado default
-- pero siguen en la tabla para auditoria.
--
-- Idempotente.

ALTER TABLE app.invitations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN app.invitations.archived_at IS
  'Marca de archivado. NULL = visible en historial. Timestamp = admin lo oculto de la UI. NUNCA borrar por auditoria.';

-- Indice parcial para queries del listado default (solo no-archivadas). El
-- volumen de invitaciones es bajo pero el index ayuda al ORDER BY created_at DESC
-- que se usa en cada carga del panel.
CREATE INDEX IF NOT EXISTS idx_invitations_not_archived_created_at
  ON app.invitations (created_at DESC)
  WHERE archived_at IS NULL;
