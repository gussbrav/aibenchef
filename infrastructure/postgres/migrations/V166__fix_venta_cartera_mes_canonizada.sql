-- =========================================================================
-- V166 — Fix marts.v_venta_cartera_mes: consolidar desde histórica en vez
-- de re-calcular con fórmula de flujo (2026-08-11)
-- =========================================================================
--
-- Bug reportado 2026-08-11: en /dashboard/informe el ratio "% Mora Global
-- (con V/C)" mostraba valores imposibles (>100%) — CMAC Arequipa 106.21%,
-- CMAC Piura 124.79%, CMAC Del Santa 133.22%.
--
-- Root cause: marts.v_venta_cartera_mes (canonizada, usada cuando
-- consolidar=true) NO consolidaba los valores REALES reportados en
-- v_venta_cartera_mes_historica. En su lugar RE-INFERIA la venta de
-- cartera con la ecuación de flujo:
--
--   venta = -(cartera_actual - cartera_prev) - castigo_mes + gpv_mes
--   (capado en 0)
--
-- Este cálculo produce artefactos MASIVOS cuando hay cambios bruscos en
-- cartera_total (ej. CMAC Arequipa Abril-26 dio venta=10.35 MM en un solo
-- mes, casi igual a su cartera bruta total). Al sumar los 12 meses:
--   venta_cartera_12m = 10.35 MM
--   cartera_bruta     = 10.75 MM
--   pct_mora_vc       = (mora + castigos + venta) / cartera = ~106%
--
-- Fix: v_venta_cartera_mes ahora consolida los valores REALES de la
-- histórica sumándolos por canónico (via resolver_nomb_correg_canonico).
-- Los valores raw ya son correctos (~180K/año para CMAC Arequipa) porque
-- vienen del reporte SBS directo.
--
-- Efecto downstream: v_venta_cartera_12m se recalcula automáticamente
-- porque agrega esta vista. v_mora_global_por_entidad tambien.
-- El fix se propaga a mv_cuadro_resumen tras refresh de MVs.
--
-- Cero data loss: la histórica se mantiene intacta. Solo cambia la
-- estrategia de consolidación por canónico.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_venta_cartera_mes AS
SELECT
    h.periodo,
    dw.resolver_nomb_correg_canonico(h.nomb_correg) AS nomb_correg,
    SUM(h.venta_cartera_mes) AS venta_cartera_mes
FROM marts.v_venta_cartera_mes_historica h
WHERE dw.resolver_nomb_correg_canonico(h.nomb_correg) IS NOT NULL
GROUP BY h.periodo, dw.resolver_nomb_correg_canonico(h.nomb_correg);

COMMENT ON VIEW marts.v_venta_cartera_mes IS
    'Venta de cartera mensual consolidada por canonico. '
    'Suma valores reales de v_venta_cartera_mes_historica agrupando por '
    'dw.resolver_nomb_correg_canonico. Fix V166 (2026-08-11): antes '
    'reinventaba el valor via formula de flujo que producia artefactos.';

-- Post-refresh de MVs downstream para que el fix llegue al dashboard.
-- Esto lo hace el worker daemon automaticamente tras cualquier import,
-- pero forzamos aca para que el fix sea visible inmediato.
-- (Nota: mv_cuadro_resumen no depende directamente — el /informe query
-- consulta v_mora_global_por_entidad en vivo, asi que el fix es inmediato).
