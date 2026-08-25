-- =========================================================================
-- V182: Fix canonizacion en marts.v_indicadores_ancho
--
-- Bug descubierto 2026-08-23 al testear la nueva seccion "Calidad de
-- Cartera" del informe: el peer group del user (nombres canonicos
-- limpios como "CMAC Arequipa", "CRAC Los Andes", "Volvo Finance")
-- no matcheaban con los nomb_correg que devuelve v_indicadores_ancho.
--
-- Causa: SBS publica nombres con espacios internos MULTIPLES y a veces
-- newlines dentro del texto de la celda del Excel:
--   "CMAC                      Arequipa"      (24 espacios)
--   "CRAC\n                    Los Andes"    (newline + espacios)
-- El JOIN previo hacia `LOWER(TRIM(en.nombre)) = LOWER(TRIM(a.entidad))`
-- pero TRIM solo elimina whitespace BORDES, no interno. Y en
-- dw.entidad_nombre estan los nombres normalizados ("CMAC Arequipa",
-- "CRAC Los Andes") con espacios simples.
--
-- Fix: normalizar espacios internos con regexp_replace(x, '\s+', ' ', 'g')
-- en AMBOS lados del JOIN. Ademas: TRIM final para bordes. LOWER para
-- case-insensitive.
--
-- Idempotente (CREATE OR REPLACE VIEW). No requiere refresh porque
-- v_indicadores_ancho es una VIEW normal (no materialized).
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_indicadores_ancho AS
SELECT
    a.periodo,
    a.fecha_cierre,
    a.tipo_entidad,
    a.entidad AS entidad_raw,
    COALESCE(em.nomb_correg_canonico, TRIM(regexp_replace(a.entidad, '\s+', ' ', 'g'))) AS nomb_correg,
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
    ON LOWER(TRIM(regexp_replace(en.nombre, '\s+', ' ', 'g')))
     = LOWER(TRIM(regexp_replace(a.entidad, '\s+', ' ', 'g')))
LEFT JOIN dw.entidad_maestra em
    ON em.id = en.entidad_id;

COMMENT ON VIEW marts.v_indicadores_ancho IS
    'V182 fix: normaliza whitespace interno (\\s+ -> " ") en AMBOS lados '
    'del JOIN con entidad_nombre. Previamente, nombres con multiples '
    'espacios/newlines internos ("CMAC                      Arequipa") no '
    'matcheaban con los alias limpios de entidad_nombre ("CMAC Arequipa"), '
    'y el nomb_correg quedaba con el string crudo raro. Ahora canoniza '
    'correctamente para el JOIN con el resto de las MVs del proyecto.';
