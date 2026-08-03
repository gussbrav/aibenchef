-- =========================================================================
-- V143 — Agregar nuevas secciones al enum de report_insights
--
-- Extensión del sistema de insights AI del /dashboard/informe con 3
-- dimensiones adicionales del framework de clasificadoras (Moody's,
-- Apoyo, Equilibrium):
--   - solvencia    (Ratio Capital Global + Fondos Capital Primario)
--   - liquidez     (RCL MN/ME + concentracion depositantes)
--   - cobertura    (Provisiones / Cartera Problema)
--
-- Antes de V143 el enum solo tenia 10 secciones. Ahora 13.
-- =========================================================================

ALTER TABLE admin.report_insights
    DROP CONSTRAINT IF EXISTS report_insights_seccion_check;

ALTER TABLE admin.report_insights
    ADD CONSTRAINT report_insights_seccion_check
    CHECK (seccion IN (
        'margen_neto',
        'cartera_bruta',
        'mora_global',
        'cobertura_car',
        'rendimiento_cartera',
        'costo_fondeo',
        'eficiencia',
        'utilidad_neta',
        'roe',
        'roa',
        -- Nuevas V143 (framework clasificadoras)
        'solvencia',
        'liquidez',
        'cobertura'
    ));

COMMENT ON COLUMN admin.report_insights.seccion IS
    'Enum de secciones soportadas. V143 agrego solvencia, liquidez y '
    'cobertura del framework de clasificadoras profesionales.';
