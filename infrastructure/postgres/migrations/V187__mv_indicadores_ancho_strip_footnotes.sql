-- =========================================================================
-- V187 — mv_indicadores_ancho: eliminar marcadores de nota al pie del SBS
--
-- PROBLEMA (descubierto 2026-09-10):
--   SBS publica el mismo indicador bajo dos variantes del nombre de la
--   entidad: el nombre base y el mismo con nota al pie. Ejemplo real:
--     "CMAC Piura"    — tiene provisiones pero NO car_ajustada
--     "CMAC Piura 1/" — tiene AMBOS indicadores (car_ajustada + provisiones)
--
--   La MV (V185) solo normalizaba whitespace, no notas al pie. Por eso
--   quedaban 2 filas distintas y "CMAC Piura" puro resultaba con
--   car_ajustada=NULL — excluida del grafico de Calidad de Cartera porque
--   el filtro WHERE car_ajustada IS NOT NULL la dejaba fuera.
--
--   Variantes que aparecen en los Excel SBS:
--     "CMAC Piura 1/"    → nota al pie con numero: \d+/
--     "B. Efectiva****"  → nota al pie con asteriscos: \*+
--
-- FIX: extender la normalizacion del entidad en SELECT/GROUP BY para
--   tambien quitar marcadores de nota al pie al final del string, igual
--   que lo hace dw.limpiar_nombre_raw:
--     1. Normalizar whitespace interno: '\s+' → ' '
--     2. Quitar asteriscos al final: '\s*\*+\s*$'
--     3. Quitar digit-slash al final: '\s*\d+/\s*$'
--   Con esto "CMAC Piura 1/" → "CMAC Piura" y ambas filas colapsan en
--   un solo GROUP, MAX() toma los valores de la fila que los tenia.
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_indicadores_ancho CASCADE;

CREATE MATERIALIZED VIEW marts.mv_indicadores_ancho AS
SELECT
    periodo,
    fecha_cierre,
    tipo_entidad,
    TRIM(
        regexp_replace(
            regexp_replace(
                regexp_replace(entidad, '\s+', ' ', 'g'),
                '\s*\*+\s*$', '', 'g'
            ),
            '\s*\d+/\s*$', '', 'g'
        )
    ) AS entidad,

    -- ============ SOLVENCIA ============
    MAX(valor) FILTER (WHERE
        seccion = 'SOLVENCIA' AND indicador_slug LIKE 'ratio%capital%global%'
    ) AS ratio_capital_global,
    MAX(valor) FILTER (WHERE
        seccion = 'SOLVENCIA' AND indicador_slug LIKE 'pasivo%total%capital%social%reservas%'
    ) AS pasivo_total_sobre_capital_reservas,

    -- ============ CALIDAD DE ACTIVOS ============
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'creditos_atrasados_creditos_directos%'
    ) AS mora_atrasados_sobre_directos,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE '%mas%90%dias%'
    ) AS mora_mayor_90_dias,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'creditos_atrasados_mn%directos_mn%'
    ) AS mora_mn,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'creditos_atrasados_me%directos_me%'
    ) AS mora_me,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'provisiones_creditos_atrasados%'
    ) AS provisiones_sobre_atrasados,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'cartera_de_alto_riesgo_creditos_directos%'
    ) AS car_sobre_directos,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'cartera_atrasada_ajustada%'
    ) AS cartera_atrasada_ajustada,
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'cartera_de_alto_riesgo_ajustada%'
    ) AS car_ajustada,

    -- ============ EFICIENCIA Y GESTION ============
    MAX(valor) FILTER (WHERE
        seccion = 'EFICIENCIA' AND indicador_slug LIKE 'gastos_de_administracion%creditos_directos%'
    ) AS gastos_admin_sobre_creditos,
    MAX(valor) FILTER (WHERE
        seccion = 'EFICIENCIA' AND indicador_slug LIKE 'gastos_de_operacion%margen_financiero%'
    ) AS gastos_op_sobre_margen_financiero,
    MAX(valor) FILTER (WHERE
        seccion = 'EFICIENCIA' AND indicador_slug LIKE 'ingresos_financieros%activo_productivo%'
    ) AS ingresos_fin_sobre_activo_productivo,
    MAX(valor) FILTER (WHERE
        seccion = 'EFICIENCIA' AND indicador_slug LIKE 'creditos_directos_empleados%'
    ) AS creditos_por_empleado_miles,
    MAX(valor) FILTER (WHERE
        seccion = 'EFICIENCIA' AND indicador_slug LIKE 'creditos_directos_numero_de_oficinas%'
    ) AS creditos_por_oficina_miles,
    MAX(valor) FILTER (WHERE
        seccion = 'EFICIENCIA' AND indicador_slug LIKE 'depositos_creditos_directos%'
    ) AS depositos_sobre_creditos,

    -- ============ RENTABILIDAD ============
    MAX(valor) FILTER (WHERE
        seccion = 'RENTABILIDAD' AND indicador_slug LIKE 'utilidad_neta%patrimonio_promedio%'
    ) AS roe_sbs,
    MAX(valor) FILTER (WHERE
        seccion = 'RENTABILIDAD' AND indicador_slug LIKE 'utilidad_neta%activo_promedio%'
    ) AS roa_sbs,

    -- ============ LIQUIDEZ ============
    MAX(valor) FILTER (WHERE
        seccion = 'LIQUIDEZ' AND indicador_slug LIKE 'ratio_de_liquidez_en_m_n%'
    ) AS ratio_liquidez_mn,
    MAX(valor) FILTER (WHERE
        seccion = 'LIQUIDEZ' AND indicador_slug LIKE 'ratio_de_liquidez_en_m_e%'
    ) AS ratio_liquidez_me,
    MAX(valor) FILTER (WHERE
        seccion = 'LIQUIDEZ' AND indicador_slug LIKE 'adeudos_pasivo_total%'
    ) AS adeudos_sobre_pasivo_total

FROM raw.indicadores_prudenciales
GROUP BY periodo, fecha_cierre, tipo_entidad,
    TRIM(
        regexp_replace(
            regexp_replace(
                regexp_replace(entidad, '\s+', ' ', 'g'),
                '\s*\*+\s*$', '', 'g'
            ),
            '\s*\d+/\s*$', '', 'g'
        )
    );

CREATE UNIQUE INDEX uq_mv_indicadores_ancho
    ON marts.mv_indicadores_ancho (periodo, tipo_entidad, entidad);

CREATE INDEX ix_mv_indicadores_ancho_periodo
    ON marts.mv_indicadores_ancho (periodo);

CREATE INDEX ix_mv_indicadores_ancho_entidad
    ON marts.mv_indicadores_ancho (entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_indicadores_ancho IS
    'V187 fix: extiende normalizacion de entidad para eliminar marcadores '
    'de nota al pie del SBS (asteriscos: \*+, digit-slash: \d+/) ademas '
    'del whitespace (V185). Con esto "CMAC Piura 1/" colapsa en "CMAC Piura" '
    'y MAX() toma car_ajustada de la variante que si la tiene.';

-- Recrear las vistas dependientes (bajadas por CASCADE)
CREATE OR REPLACE VIEW marts.v_indicadores_ancho AS
SELECT
    a.periodo, a.fecha_cierre, a.tipo_entidad,
    a.entidad AS entidad_raw,
    COALESCE(em.nomb_correg_canonico, a.entidad) AS nomb_correg,
    a.ratio_capital_global, a.pasivo_total_sobre_capital_reservas,
    a.mora_atrasados_sobre_directos, a.mora_mayor_90_dias,
    a.mora_mn, a.mora_me, a.provisiones_sobre_atrasados,
    a.car_sobre_directos, a.cartera_atrasada_ajustada, a.car_ajustada,
    a.gastos_admin_sobre_creditos, a.gastos_op_sobre_margen_financiero,
    a.ingresos_fin_sobre_activo_productivo, a.creditos_por_empleado_miles,
    a.creditos_por_oficina_miles, a.depositos_sobre_creditos,
    a.roe_sbs, a.roa_sbs, a.ratio_liquidez_mn, a.ratio_liquidez_me,
    a.adeudos_sobre_pasivo_total
FROM marts.mv_indicadores_ancho a
LEFT JOIN LATERAL (
    SELECT em2.nomb_correg_canonico
    FROM dw.entidad_nombre en
    JOIN dw.entidad_maestra em2 ON em2.id = en.entidad_id
    WHERE LOWER(en.nombre) = LOWER(a.entidad)
    ORDER BY CASE en.tipo WHEN 'canonico' THEN 0 WHEN 'razon_social' THEN 1 WHEN 'alias' THEN 2 WHEN 'historico' THEN 3 ELSE 9 END
    LIMIT 1
) em ON true;

COMMENT ON VIEW marts.v_indicadores_ancho IS
    'V187: wrapper canonizador sobre mv_indicadores_ancho. LATERAL + LIMIT 1 (V186/V184).';

CREATE OR REPLACE VIEW marts.v_dq_drift_kpis_sbs AS
WITH ratios_sbs AS (
    SELECT periodo, nomb_correg, mora_atrasados_sobre_directos AS mora_sbs_pct
    FROM marts.v_indicadores_ancho WHERE mora_atrasados_sobre_directos IS NOT NULL
),
ratios_aibenchef AS (
    SELECT periodo, nomb_correg,
        CASE WHEN cartera_bruta > 0 THEN ROUND((cartera_atrasada / cartera_bruta * 100)::numeric, 4) ELSE NULL END AS mora_aibenchef_pct
    FROM marts.v_mora_global_por_entidad WHERE cartera_bruta > 0
)
SELECT s.periodo, s.nomb_correg,
    'mora_atrasados_sobre_directos' AS kpi,
    s.mora_sbs_pct AS valor_sbs, a.mora_aibenchef_pct AS valor_aibenchef,
    (a.mora_aibenchef_pct - s.mora_sbs_pct) AS drift_pp,
    ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) AS drift_abs_pp,
    CASE
        WHEN a.mora_aibenchef_pct IS NULL THEN 'sin_calculo_aibenchef'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.10 THEN 'ok'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.50 THEN 'info'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 2.00 THEN 'warning'
        ELSE 'critical'
    END AS severity
FROM ratios_sbs s LEFT JOIN ratios_aibenchef a ON a.periodo = s.periodo AND a.nomb_correg = s.nomb_correg;

COMMENT ON VIEW marts.v_dq_drift_kpis_sbs IS 'V187: restaurada tras CASCADE de V187.';
