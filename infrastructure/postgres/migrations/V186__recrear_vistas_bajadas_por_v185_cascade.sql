-- =========================================================================
-- V186 — Recrear vistas bajadas por el CASCADE de V185
--
-- V185 hizo DROP MATERIALIZED VIEW marts.mv_indicadores_ancho CASCADE.
-- Ese CASCADE elimino automaticamente:
--   1. marts.v_indicadores_ancho   (depende de la MV)
--   2. marts.v_dq_drift_kpis_sbs  (depende de v_indicadores_ancho)
--
-- V185 no las recrea — este script las restaura. Corresponde a la misma
-- logica de V184 (LATERAL + LIMIT 1 con prioridad de tipo canonico) y
-- V158 (drift KPIs SBS vs aibenchef).
-- =========================================================================

-- 1. Vista principal: wrapper canonizador sobre mv_indicadores_ancho.
--    La MV ahora ya entrega entidad con espacios normalizados (V185),
--    por lo que el JOIN usa LOWER() directo sin regexp_replace adicional.
CREATE OR REPLACE VIEW marts.v_indicadores_ancho AS
SELECT
    a.periodo,
    a.fecha_cierre,
    a.tipo_entidad,
    a.entidad AS entidad_raw,
    COALESCE(em.nomb_correg_canonico, a.entidad) AS nomb_correg,
    a.ratio_capital_global,
    a.pasivo_total_sobre_capital_reservas,
    a.mora_atrasados_sobre_directos,
    a.mora_mayor_90_dias,
    a.mora_mn,
    a.mora_me,
    a.provisiones_sobre_atrasados,
    a.car_sobre_directos,
    a.cartera_atrasada_ajustada,
    a.car_ajustada,
    a.gastos_admin_sobre_creditos,
    a.gastos_op_sobre_margen_financiero,
    a.ingresos_fin_sobre_activo_productivo,
    a.creditos_por_empleado_miles,
    a.creditos_por_oficina_miles,
    a.depositos_sobre_creditos,
    a.roe_sbs,
    a.roa_sbs,
    a.ratio_liquidez_mn,
    a.ratio_liquidez_me,
    a.adeudos_sobre_pasivo_total
FROM marts.mv_indicadores_ancho a
LEFT JOIN LATERAL (
    SELECT em2.nomb_correg_canonico
    FROM dw.entidad_nombre en
    JOIN dw.entidad_maestra em2 ON em2.id = en.entidad_id
    WHERE LOWER(en.nombre) = LOWER(a.entidad)
    ORDER BY
        CASE en.tipo
            WHEN 'canonico'     THEN 0
            WHEN 'razon_social' THEN 1
            WHEN 'alias'        THEN 2
            WHEN 'historico'    THEN 3
            ELSE 9
        END
    LIMIT 1
) em ON true;

COMMENT ON VIEW marts.v_indicadores_ancho IS
    'V186: restaurada tras CASCADE de V185. Wrapper sobre mv_indicadores_ancho '
    '(V185: entidad ya normalizada con regexp_replace) con canonizacion via '
    'LATERAL + LIMIT 1 priorizando tipo canonico. Consumir esta vista — no '
    'la MV directamente — para obtener nomb_correg canonico.';

-- 2. Vista de drift monitoring (V158), restaurada.
CREATE OR REPLACE VIEW marts.v_dq_drift_kpis_sbs AS
WITH ratios_sbs AS (
    SELECT
        periodo,
        nomb_correg,
        mora_atrasados_sobre_directos AS mora_sbs_pct
    FROM marts.v_indicadores_ancho
    WHERE mora_atrasados_sobre_directos IS NOT NULL
),
ratios_aibenchef AS (
    SELECT
        periodo,
        nomb_correg,
        CASE
            WHEN cartera_bruta > 0
            THEN ROUND((cartera_atrasada / cartera_bruta * 100)::numeric, 4)
            ELSE NULL
        END AS mora_aibenchef_pct
    FROM marts.v_mora_global_por_entidad
    WHERE cartera_bruta > 0
)
SELECT
    s.periodo,
    s.nomb_correg,
    'mora_atrasados_sobre_directos'              AS kpi,
    s.mora_sbs_pct                               AS valor_sbs,
    a.mora_aibenchef_pct                         AS valor_aibenchef,
    (a.mora_aibenchef_pct - s.mora_sbs_pct)      AS drift_pp,
    ABS(a.mora_aibenchef_pct - s.mora_sbs_pct)   AS drift_abs_pp,
    CASE
        WHEN a.mora_aibenchef_pct IS NULL                        THEN 'sin_calculo_aibenchef'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.10  THEN 'ok'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.50  THEN 'info'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 2.00  THEN 'warning'
        ELSE 'critical'
    END AS severity
FROM ratios_sbs s
LEFT JOIN ratios_aibenchef a
    ON a.periodo = s.periodo AND a.nomb_correg = s.nomb_correg;

COMMENT ON VIEW marts.v_dq_drift_kpis_sbs IS
    'V186: restaurada tras CASCADE de V185. Drift monitoring KPIs '
    'aibenchef vs SBS oficial. Ver V158 para descripcion completa.';
