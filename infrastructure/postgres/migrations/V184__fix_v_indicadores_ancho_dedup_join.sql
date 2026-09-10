-- =========================================================================
-- V184 — marts.v_indicadores_ancho: eliminar duplicados por case-variants
--
-- PROBLEMA (descubierto 2026-09-10):
--   dw.entidad_nombre tiene MULTIPLES entradas para la misma entidad con
--   distinto casing:
--     "CRAC Los Andes"   tipo='canonico'   → entidad_id=X
--     "CRAC LOS ANDES"   tipo='razon_social' → entidad_id=X
--   Despues de LOWER(TRIM(regexp_replace(..., '\s+', ' ', 'g'))) (V182)
--   ambas dan "crac los andes", por lo que el LEFT JOIN produce 2 filas
--   por entidad. Mismo problema con Financiera Confianza y Volvo Finance.
--
-- FIX: reemplazar los dos LEFT JOINs separados por un unico LEFT JOIN
--   LATERAL con LIMIT 1, priorizando el tipo='canonico' sobre 'razon_social'
--   > 'alias' > 'historico'. Esto garantiza exactamente 0 o 1 fila de
--   canonizacion por cada fila de mv_indicadores_ancho, eliminando el
--   fan-out. La normalizacion de whitespace (V182) se conserva en el WHERE.
-- =========================================================================

CREATE OR REPLACE VIEW marts.v_indicadores_ancho AS
SELECT
    a.periodo,
    a.fecha_cierre,
    a.tipo_entidad,
    a.entidad AS entidad_raw,
    COALESCE(em.nomb_correg_canonico,
             TRIM(regexp_replace(a.entidad, '\s+', ' ', 'g'))) AS nomb_correg,
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
    WHERE LOWER(TRIM(regexp_replace(en.nombre, '\s+', ' ', 'g')))
        = LOWER(TRIM(regexp_replace(a.entidad, '\s+', ' ', 'g')))
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
    'V184 fix: reemplaza el doble LEFT JOIN por un LEFT JOIN LATERAL con '
    'LIMIT 1 para evitar filas duplicadas cuando dw.entidad_nombre tiene '
    'multiples entradas del mismo nombre en distinto casing ("CRAC Los Andes" '
    'y "CRAC LOS ANDES"). Prioriza tipo canonico > razon_social > alias > '
    'historico. Conserva la normalizacion de whitespace interno de V182 '
    '(regexp_replace \\s+ -> " " en ambos lados del WHERE).';
