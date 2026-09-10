-- =========================================================================
-- V185 — marts.mv_indicadores_ancho: normalizar entidad en GROUP BY
--
-- PROBLEMA (descubierto 2026-09-10):
--   raw.indicadores_prudenciales contiene multiples filas para la misma
--   entidad en el mismo periodo cuando el importer encuentra el nombre con
--   variaciones de whitespace interno:
--     "CMAC                    \n Arequipa"  (newline + espacios)
--     "CMAC                      Arequipa"   (solo espacios multiples)
--   El GROUP BY previo usaba el string raw, por lo que cada variante
--   generaba una fila separada en la MV. Esas 2 filas, al pasar por
--   v_indicadores_ancho (V184), se canonizaban al mismo nomb_correg
--   ("CMAC Arequipa") produciendo duplicados visibles en el informe.
--
-- FIX: normalizar el campo entidad en el SELECT y GROUP BY de la MV
--   con TRIM(regexp_replace(entidad, '\s+', ' ', 'g')). Esto colapsa
--   todas las variantes de whitespace al mismo string limpio, y el MAX()
--   FILTER agrega todos los indicadores de la misma entidad en una sola fila.
--   El UNIQUE INDEX se recrea con el campo normalizado.
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_indicadores_ancho CASCADE;

CREATE MATERIALIZED VIEW marts.mv_indicadores_ancho AS
SELECT
    periodo,
    fecha_cierre,
    tipo_entidad,
    TRIM(regexp_replace(entidad, '\s+', ' ', 'g')) AS entidad,

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
         TRIM(regexp_replace(entidad, '\s+', ' ', 'g'));

CREATE UNIQUE INDEX uq_mv_indicadores_ancho
    ON marts.mv_indicadores_ancho (periodo, tipo_entidad, entidad);

CREATE INDEX ix_mv_indicadores_ancho_periodo
    ON marts.mv_indicadores_ancho (periodo);

CREATE INDEX ix_mv_indicadores_ancho_entidad
    ON marts.mv_indicadores_ancho (entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_indicadores_ancho IS
    'V185 fix: normaliza whitespace interno del campo entidad con '
    'TRIM(regexp_replace(entidad, \\s+, " ", g)) en SELECT y GROUP BY '
    'para colapsar variantes con newlines/espacios multiples en una sola '
    'fila por (periodo, tipo_entidad, entidad). Evita duplicados downstream '
    'en v_indicadores_ancho. Refrescar con REFRESH MATERIALIZED VIEW '
    'CONCURRENTLY marts.mv_indicadores_ancho tras cada import mensual.';

-- Recrear las vistas bajadas por el CASCADE del DROP anterior.
-- IMPORTANTE: este bloque debe ir siempre al final de cualquier migracion
-- que haga DROP MATERIALIZED VIEW ... CASCADE sobre mv_indicadores_ancho.
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
