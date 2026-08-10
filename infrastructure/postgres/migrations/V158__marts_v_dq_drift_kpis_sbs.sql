-- =========================================================================
-- V158 — Data Quality: drift monitoring entre KPIs aibenchef vs SBS oficial
--
-- CONTEXTO: la V156 creo marts.v_indicadores_ancho que expone los KPIs
-- OFICIALES publicados por SBS (ROE, ROA, mora, CAR, etc). Los dashboards
-- de aibenchef calculan sus propios KPIs desde EEFF + colocaciones con
-- formula TTM propia. Si nuestro calculo se desvia del oficial SBS por
-- un cambio de formula o un bug de import, hoy no lo detectamos hasta
-- que un usuario compara manualmente y reporta ("¿por que tu mora dice
-- 6.61% y el Excel oficial dice 6.61%? — ah, coincide. Pero ¿y CMAC
-- Cusco? aibenchef 4.91% SBS 4.91% — coincide. ¿Y BCP? — aibenchef
-- 5.02% SBS 3.34% — DRIFT ⚠").
--
-- Esta vista implementa el drift monitoring V1 — compara los 4 ratios
-- que tenemos disponibles en ambos lados:
--
--   Ratio SBS oficial (v_indicadores_ancho)  ↔  Ratio calculado aibenchef
--   ─────────────────────────────────────────────────────────────────────
--   mora_atrasados_sobre_directos            ↔  cartera_atrasada / cartera_bruta
--                                              (v_colocaciones_agregado_entidad)
--
-- V1 solo cubre mora_atrasada (proof-of-concept). Ampliar a ROE/ROA/CAR
-- en V2 cuando tengamos las MVs equivalentes calculadas en el DW
-- (hoy ROE/ROA solo se calculan on-the-fly en el frontend).
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_dq_drift_kpis_sbs AS
WITH ratios_sbs AS (
    -- KPIs oficiales del reporte SBS mensual (V156). El nomb_correg ya
    -- viene canonizado desde la vista v_indicadores_ancho.
    SELECT
        periodo,
        nomb_correg,
        mora_atrasados_sobre_directos AS mora_sbs_pct   -- % (ej. 6.61 = 6.61%)
    FROM marts.v_indicadores_ancho
    WHERE mora_atrasados_sobre_directos IS NOT NULL
),
ratios_aibenchef AS (
    -- Formula equivalente calculada desde nuestras MVs. Ratio en decimal
    -- (0-1) desde v_mora_global_por_entidad — reconstruimos el ratio
    -- basico Atrasada / Directos (SIN refin ni castigos) para comparar
    -- de forma equivalente con el ratio SBS.
    SELECT
        periodo,
        nomb_correg,
        CASE
            WHEN cartera_bruta > 0
            THEN ROUND((cartera_atrasada / cartera_bruta * 100)::numeric, 4)
            ELSE NULL
        END AS mora_aibenchef_pct  -- convertido a % para comparacion 1:1
    FROM marts.v_mora_global_por_entidad
    WHERE cartera_bruta > 0
)
SELECT
    s.periodo,
    s.nomb_correg,
    'mora_atrasados_sobre_directos' AS kpi,
    s.mora_sbs_pct                  AS valor_sbs,
    a.mora_aibenchef_pct            AS valor_aibenchef,
    (a.mora_aibenchef_pct - s.mora_sbs_pct)                   AS drift_pp,
    ABS(a.mora_aibenchef_pct - s.mora_sbs_pct)                AS drift_abs_pp,
    CASE
        WHEN a.mora_aibenchef_pct IS NULL THEN 'sin_calculo_aibenchef'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.10 THEN 'ok'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.50 THEN 'info'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 2.00 THEN 'warning'
        ELSE 'critical'
    END AS severity
FROM ratios_sbs s
LEFT JOIN ratios_aibenchef a
    ON a.periodo = s.periodo AND a.nomb_correg = s.nomb_correg;

COMMENT ON VIEW marts.v_dq_drift_kpis_sbs IS
    'V158: drift monitoring KPIs aibenchef vs SBS oficial. Compara ratio '
    'oficial de v_indicadores_ancho (V156) contra el calculado desde '
    'v_mora_global_por_entidad. Thresholds: <0.10pp ok, <0.50pp info, '
    '<2pp warning, >=2pp critical. Consumir desde CLI '
    'aibenchef pipeline drift-check-sbs y persistir en '
    'admin.data_quality_checks para monitoreo continuo.';
