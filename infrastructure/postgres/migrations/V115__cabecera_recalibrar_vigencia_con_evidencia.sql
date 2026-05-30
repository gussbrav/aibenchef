-- =========================================================================
-- V115: recalibrar cabecera_maestra.valido_desde con evidencia real del .xls
--       (issue #65, post-backfill V113/V114)
--
-- PROBLEMA:
--   Algunas cuentas tienen valido_desde mal calibrado vs lo que el archivo
--   SBS realmente trae. Casos detectados post-backfill 1040 archivos:
--
--   - "B1.3.4 Otros" CMAC/CRAC/BANCOS: cabecera valido_desde=201301, pero
--     el archivo 200901 ya la trae → 48 periodos con falsa "extra"
--   - "B1.5.2 Relacionadas con Inversiones": mismo caso
--   - 18+ cuentas FINANCIERAS con valido_desde=201102 pero archivo 200901
--     ya las trae
--
-- IMPACTO UI:
--   Inspector muestra estas cuentas como "extras en archivo NO en cabecera"
--   para todos los periodos < valido_desde, generando ruido y haciendo
--   parecer que hay drift SBS cuando en realidad la cabecera mal-defino
--   la vigencia.
--
-- FIX:
--   Por cada (tipo_estado, tipo_entidad, codigo) vigente, bajar valido_desde
--   a MIN(periodo) observado en raw.eeff_celda_cruda. Esto rectifica la
--   cabecera con la realidad observable.
--
-- SEGURIDAD:
--   - Solo BAJA valido_desde (expande hacia atras). Nunca lo sube — no
--     ocultaria evidencia legitima del parser.
--   - Solo afecta cabecera vigente (valido_hasta IS NULL).
--   - Si la cuenta nunca aparecio en celda_cruda, no se toca.
--   - Idempotente: re-ejecutar produce el mismo resultado (LEAST nunca
--     incrementa).
-- =========================================================================

UPDATE dw.cabecera_maestra cm
SET valido_desde = LEAST(cm.valido_desde, evidencia.min_periodo)
FROM (
    SELECT
        cc.tipo_estado,
        cc.tipo_entidad,
        cc.cuenta_codigo AS codigo,
        MIN(cc.periodo) AS min_periodo
    FROM raw.eeff_celda_cruda cc
    WHERE cc.cuenta_codigo IS NOT NULL
    GROUP BY cc.tipo_estado, cc.tipo_entidad, cc.cuenta_codigo
) AS evidencia
WHERE cm.tipo_estado  = evidencia.tipo_estado
  AND cm.tipo_entidad = evidencia.tipo_entidad
  AND cm.codigo       = evidencia.codigo
  AND cm.valido_hasta IS NULL
  AND cm.valido_desde > evidencia.min_periodo;
