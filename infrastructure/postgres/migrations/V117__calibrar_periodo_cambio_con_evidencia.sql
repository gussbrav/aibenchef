-- =========================================================================
-- V117: calibrar entidad_renombre.periodo_cambio con evidencia real
--       de cuando el nombre nuevo aparecio en raw.eeff_observacion.
--
-- PROBLEMA:
--   `entidad_renombre.periodo_cambio` se carga con la fecha LEGAL del
--   rebranding (ej. Resolucion SBS 202303 para Financiera Compartamos ->
--   Compartamos Banco). Pero el nombre nuevo a veces tarda en aparecer en
--   los archivos SBS publicados — Compartamos Banco no aparece como entidad
--   en raw.eeff_observacion hasta 202501 (gap de 22 meses).
--
--   Si V116 (`resolver_nomb_correg_para_periodo`) usa periodo_cambio=202303,
--   para periodos 202303-202412 retorna 'Compartamos Banco' pero la MV
--   solo tiene 'Financiera Compartamos' → ratios NULL.
--
-- FIX:
--   periodo_cambio = MAX(periodo_cambio_actual, primera_aparicion_real).
--   Solo INCREMENTA (LEAST en sentido inverso) — nunca lo baja, porque
--   bajar puede generar matches incorrectos.
--
-- IDEMPOTENTE: se puede re-ejecutar; el GREATEST nunca decrementa.
-- =========================================================================

UPDATE dw.entidad_renombre er
SET periodo_cambio = GREATEST(er.periodo_cambio, ev.primera_aparicion)
FROM (
    SELECT eo.nomb_correg, MIN(eo.periodo) AS primera_aparicion
    FROM raw.eeff_observacion eo
    GROUP BY eo.nomb_correg
) AS ev
WHERE er.nomb_correg_actual = ev.nomb_correg
  AND er.activo
  AND er.periodo_cambio IS NOT NULL
  AND er.periodo_cambio < ev.primera_aparicion;
