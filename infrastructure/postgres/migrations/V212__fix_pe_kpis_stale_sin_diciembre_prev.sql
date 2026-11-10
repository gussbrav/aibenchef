-- =========================================================================
-- V212: Eliminar KPIs de Punto de Equilibrio calculados con datos incompletos
--
-- Escenario: algunas entidades tuvieron datos del diciembre anterior (Dic_prev)
-- en mv_eeff_resultados_ancho en el momento del calculo, pero ese dato fue
-- eliminado despues (MV refresh, correccion de datos SBS, etc.). El valor
-- almacenado es stale — no puede verificarse contra los datos actuales y
-- tipicamente esta distorsionado (ej: MICROWD JUN 2026 muestra 3.84% en vez
-- de ~19% historico).
--
-- Regla: si ttm_resultados() devuelve NULL HOY para ese (periodo, entidad),
-- el KPI no es confiable. Se elimina para que la UI muestre "—".
-- Cuando SBS publique el dato faltante, el operador re-corre
-- compute_kpis_punto_equilibrio(periodo) para repoblar.
--
-- Condicion: pe_rendimiento != 0 (los ceros ya se limpiaron en V211)
-- Y faltan datos de Dic_prev O del mismo mes del año anterior.
-- =========================================================================

DELETE FROM marts.fact_kpis_mensuales
WHERE kpi_codigo LIKE 'pe_%'
  AND (periodo, nomb_correg, moneda) IN (
    SELECT f.periodo, f.nomb_correg, f.moneda
    FROM marts.fact_kpis_mensuales f
    WHERE f.kpi_codigo = 'pe_rendimiento_cartera'
      AND f.moneda = 'TOTAL'
      AND f.valor != 0
      AND (
        NOT EXISTS (
          SELECT 1 FROM marts.mv_eeff_resultados_ancho r
          WHERE r.nomb_correg = f.nomb_correg
            AND r.moneda = 'TOTAL'
            AND r.periodo = ((f.periodo / 100 - 1) * 100 + 12)
        )
        OR
        NOT EXISTS (
          SELECT 1 FROM marts.mv_eeff_resultados_ancho r
          WHERE r.nomb_correg = f.nomb_correg
            AND r.moneda = 'TOTAL'
            AND r.periodo = (f.periodo - 100)
        )
      )
  );
