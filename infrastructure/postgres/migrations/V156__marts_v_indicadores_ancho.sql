-- =========================================================================
-- V156 — marts.v_indicadores_ancho
--
-- CONTEXTO: raw.indicadores_prudenciales (V086) almacena en long-format
-- todos los indicadores oficiales SBS del reporte consolidado mensual
-- (B-2401 BANCOS, B-3301 FINANCIERAS, C-1301 CMAC, C-2301 CRAC, C-4301
-- EDPYMES). Cada fila = (periodo, tipo_entidad, entidad, indicador_slug,
-- valor). El importer python genera slugs dinamicamente del nombre del
-- indicador via lower + strip accents + regex.
--
-- PROBLEMA: los consumidores del dashboard (informe, PE, DuPont) NO
-- consultan esta tabla. Calculan sus propios KPIs desde EEFF + colocaciones
-- con formula TTM propia — y **pueden diferir de las cifras oficiales SBS**
-- que el analista compara contra el reporte publicado. Esto genera dudas
-- de trazabilidad ("¿por que tu ROE dice 20.55% y el Excel de SBS dice
-- 20.55%? — ah, coincide; pero el CMAC del Santa aibenchef 1.40% y SBS
-- Del Santa 1.40% — ¿es exacto o hay drift?").
--
-- SOLUCION: esta MV pivotea los indicadores mas usados a formato ancho
-- (una fila por entidad-periodo, cada indicador su columna) — asi
-- podemos:
--   1. Mostrar los indicadores oficiales SBS directamente en el informe.
--   2. Validar los KPIs calculados por aibenchef vs los oficiales SBS
--      (drift monitoring).
--   3. Cubrir indicadores que aibenchef HOY no calcula: Cartera
--      Ajustada, Cobertura, Ratio Capital Global, Ratios de Liquidez.
--
-- PATTERN MATCHING: los slugs del importer se generan dinamicamente
-- (lower + strip + regex). Para tolerar variaciones menores, usamos
-- FILTER con LIKE en vez de igualdad exacta. Ejemplo: el slug real
-- podria ser 'ratio_de_capital_global' o 'ratio_de_capital_global_al_'
-- o 'ratio_capital_global' — matcheamos con 'ratio%capital%global%'.
-- =========================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS marts.mv_indicadores_ancho AS
SELECT
    periodo,
    fecha_cierre,
    tipo_entidad,
    entidad,

    -- ============ SOLVENCIA ============
    MAX(valor) FILTER (WHERE
        seccion = 'SOLVENCIA' AND indicador_slug LIKE 'ratio%capital%global%'
    ) AS ratio_capital_global,
    MAX(valor) FILTER (WHERE
        seccion = 'SOLVENCIA' AND indicador_slug LIKE 'pasivo%total%capital%social%reservas%'
    ) AS pasivo_total_sobre_capital_reservas,

    -- ============ CALIDAD DE ACTIVOS ============
    -- Cartera atrasada / directos (basico, sin ajuste)
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'creditos_atrasados_creditos_directos%'
    ) AS mora_atrasados_sobre_directos,
    -- Cartera atrasada > 90 dias (criterio internacional, mas estricto)
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE '%mas%90%dias%'
    ) AS mora_mayor_90_dias,
    -- Mora en MN
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'creditos_atrasados_mn%directos_mn%'
    ) AS mora_mn,
    -- Mora en ME
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'creditos_atrasados_me%directos_me%'
    ) AS mora_me,
    -- Cobertura de provisiones sobre cartera atrasada
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'provisiones_creditos_atrasados%'
    ) AS provisiones_sobre_atrasados,
    -- Cartera de Alto Riesgo (CAR: atrasada + refin + reestructurados)
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'cartera_de_alto_riesgo_creditos_directos%'
    ) AS car_sobre_directos,
    -- Cartera atrasada ajustada (incluye castigos)
    MAX(valor) FILTER (WHERE
        seccion = 'CALIDAD_ACTIVOS' AND indicador_slug LIKE 'cartera_atrasada_ajustada%'
    ) AS cartera_atrasada_ajustada,
    -- Cartera de alto riesgo ajustada (con castigos)
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
    -- ROE oficial SBS (Utilidad Neta anualizada / Patrimonio Promedio)
    MAX(valor) FILTER (WHERE
        seccion = 'RENTABILIDAD' AND indicador_slug LIKE 'utilidad_neta%patrimonio_promedio%'
    ) AS roe_sbs,
    -- ROA oficial SBS (Utilidad Neta anualizada / Activo Promedio)
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
GROUP BY periodo, fecha_cierre, tipo_entidad, entidad;

-- Indices para queries frecuentes
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_indicadores_ancho
    ON marts.mv_indicadores_ancho (periodo, tipo_entidad, entidad);

CREATE INDEX IF NOT EXISTS ix_mv_indicadores_ancho_periodo
    ON marts.mv_indicadores_ancho (periodo);

CREATE INDEX IF NOT EXISTS ix_mv_indicadores_ancho_entidad
    ON marts.mv_indicadores_ancho (entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_indicadores_ancho IS
    'Indicadores oficiales SBS pivoteados a formato ancho (1 fila por '
    'periodo+entidad, cada indicador su columna). Fuente: raw.indicadores_'
    'prudenciales (long-format). Refrescar despues de correr el importer '
    'monthly_indicadores_importer (typico: 3x/dia junto con el resto del '
    'pipeline SBS). REFRESH MATERIALIZED VIEW CONCURRENTLY para no '
    'bloquear reads del dashboard.';

-- Refresh inicial — si la tabla source aun no tiene data, la MV queda
-- vacia (no falla). Los reads devuelven 0 filas hasta el siguiente refresh.
REFRESH MATERIALIZED VIEW marts.mv_indicadores_ancho;

-- ============ Vista helper: join con canonizacion de entidades ============
-- La tabla source usa el nombre "entidad" tal como aparece en el Excel
-- SBS. Algunas entidades tienen variaciones ("BBVA Continental" vs
-- "Banco BBVA Peru"). Esta vista canoniza el nombre via dw.entidad_nombre
-- para join limpio con el resto del sistema (que usa nomb_correg canonico).
--
-- Si un nombre del Excel NO esta en la maestra, se preserva tal cual
-- (fallback conservador — no perder data).

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
LEFT JOIN dw.entidad_nombre en
    ON LOWER(TRIM(en.nombre)) = LOWER(TRIM(a.entidad))
LEFT JOIN dw.entidad_maestra em
    ON em.id = en.entidad_id;

COMMENT ON VIEW marts.v_indicadores_ancho IS
    'Wrapper sobre mv_indicadores_ancho con canonizacion de entidad_raw '
    'a nomb_correg (usando dw.entidad_nombre + dw.entidad_maestra). Los '
    'consumidores del informe deben usar ESTA vista, no la MV directamente '
    '— asi obtienen nomb_correg canonico y pueden hacer join limpio con '
    'el resto de las MV del proyecto (mv_eeff_resultados_ancho, etc).';
