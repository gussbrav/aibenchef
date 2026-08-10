-- =========================================================================
-- V155 — Agregar 'punto_equilibrio' al enum de secciones de report_insights
--
-- BUG FIX: al agregar el enum 'punto_equilibrio' en TS (types.ts) y el
-- prompt template (prompts/punto-equilibrio.ts) para el "Analisis del
-- experto" en /dashboard/punto-equilibrio, olvidamos actualizar el CHECK
-- constraint de la tabla admin.report_insights (creada en V141, ampliada
-- en V143 con solvencia/liquidez/cobertura).
--
-- Resultado: cuando el usuario hacia click en "Generar analisis con IA"
-- desde el Cuadro Comparativo por Entidad, el INSERT fallaba con
-- PostgreSQL 23514 (check_violation), y la UI mostraba "Valor invalido".
--
-- Esta migration extiende el enum para que 'punto_equilibrio' sea valido.
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
        -- V143 (framework clasificadoras)
        'solvencia',
        'liquidez',
        'cobertura',
        -- V155 (analisis experto del /dashboard/punto-equilibrio)
        'punto_equilibrio'
    ));

COMMENT ON COLUMN admin.report_insights.seccion IS
    'Enum de secciones soportadas. V143 agrego solvencia/liquidez/cobertura. '
    'V155 agrego punto_equilibrio para el Analisis del experto en el Cuadro '
    'Comparativo del /dashboard/punto-equilibrio.';
