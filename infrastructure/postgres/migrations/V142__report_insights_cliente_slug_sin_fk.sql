-- =========================================================================
-- V142 — Remover FK de report_insights.cliente_slug -> config.cliente
--
-- Bug detectado post-V141: cuando el user visita /dashboard/informe con
-- un cliente que no esta sembrado en config.cliente (ej. BCP fallback
-- de demo, slug='bcp'), el INSERT en admin.report_insights falla con:
--
--   error 23503: Key (cliente_slug)=(bcp) is not present in table "cliente"
--
-- La columna cliente_slug en report_insights es DENORMALIZACION para
-- tracking/agrupacion (v_insights_cost_por_cliente), NO integridad
-- referencial. Misma decision que se tomo con insights_user_usage
-- que ya se creo sin FK.
--
-- Fix: dropear el FK. Mantener la columna como TEXT libre.
-- =========================================================================

ALTER TABLE admin.report_insights
    DROP CONSTRAINT IF EXISTS report_insights_cliente_slug_fkey;

COMMENT ON COLUMN admin.report_insights.cliente_slug IS
    'Slug del cliente del informe. Sin FK a config.cliente (V142) porque '
    'clientes demo/fallback (ej. bcp) no estan sembrados. Denormalizacion '
    'usada solo para agrupar en admin.v_insights_cost_por_cliente.';
