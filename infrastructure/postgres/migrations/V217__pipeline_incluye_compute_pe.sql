-- =========================================================================
-- V217: Integrar compute_kpis_punto_equilibrio al pipeline refresh_all_derived
--
-- PROBLEMA detectado 2026-11-18
--   Tras la ingesta normal (SBS publica → sync_jobs → work-jobs → pipeline
--   refresh-derived), los KPIs de Punto de Equilibrio quedaban vacíos para
--   el periodo recién importado. El dashboard mostraba columnas "—" para
--   todo el bloque PE aunque los datos crudos y los ratios SBS (ROE, mora,
--   cobertura) sí aparecían.
--
--   Root cause: `marts.refresh_all_derived()` (V134) solo ejecuta 3 pasos:
--     1. dw.recalcular_microfinancieras(periodo)
--     2. marts.refresh_kpis_anuales()
--     3. marts.refresh_all_marts(concurrent)
--
--   NO llama a `marts.compute_kpis_punto_equilibrio(periodo)` — por eso los
--   10 KPIs pe_* en fact_kpis_mensuales + metadata en fact_pe_metadata sólo
--   aparecían cuando una migración (V214/V215/V216) o un operador manual
--   los disparaba.
--
-- SOLUCIÓN
--   Agregar Paso 4 a `marts.refresh_all_derived`:
--     4. marts.compute_kpis_punto_equilibrio(periodo)
--
--   Si p_periodo IS NULL (refresh global, usado solo en bootstrap), se
--   skippea el paso con un detail explícito — no queremos recalcular todo
--   el histórico PE automáticamente (es caro y no idempotente para KPIs
--   borrados por V212 deliberadamente).
--
--   Idempotente: compute_kpis_PE usa ON CONFLICT DO UPDATE SET.
--
-- IMPACTO
--   De ahora en adelante, cuando SBS publique un nuevo periodo:
--     sync_job → scrape → import → refresh-derived (incluye PE auto) →
--     dashboard muestra PE inmediatamente, sin intervención manual.
-- =========================================================================

CREATE OR REPLACE FUNCTION marts.refresh_all_derived(
    p_periodo INT DEFAULT NULL,
    p_concurrent BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
    step_name TEXT,
    duration_ms INT,
    success BOOLEAN,
    detail TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    started_at TIMESTAMPTZ;
    finished_at TIMESTAMPTZ;
    n_rows INT;
    marts_summary TEXT;
    pe_entidades INT;
BEGIN
    -- Paso 1: recalcular_microfinancieras(periodo)
    started_at := clock_timestamp();
    BEGIN
        SELECT dw.recalcular_microfinancieras(p_periodo) INTO n_rows;
        finished_at := clock_timestamp();
        step_name := 'dw.recalcular_microfinancieras';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := TRUE;
        detail := format('rows_inserted=%s periodo=%s', n_rows,
            COALESCE(p_periodo::text, 'TODOS'));
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        finished_at := clock_timestamp();
        step_name := 'dw.recalcular_microfinancieras';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := FALSE;
        detail := SQLERRM;
        RETURN NEXT;
    END;

    -- Paso 2: refresh_kpis_anuales
    started_at := clock_timestamp();
    BEGIN
        PERFORM marts.refresh_kpis_anuales();
        finished_at := clock_timestamp();
        step_name := 'marts.refresh_kpis_anuales';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := TRUE;
        detail := 'OK';
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        finished_at := clock_timestamp();
        step_name := 'marts.refresh_kpis_anuales';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := FALSE;
        detail := SQLERRM;
        RETURN NEXT;
    END;

    -- Paso 3: refresh_all_marts
    started_at := clock_timestamp();
    BEGIN
        SELECT
            format('OK=%s FAIL=%s',
                   COUNT(*) FILTER (WHERE r.success),
                   COUNT(*) FILTER (WHERE NOT r.success))
            INTO marts_summary
        FROM marts.refresh_all_marts(p_concurrent) r;
        finished_at := clock_timestamp();
        step_name := 'marts.refresh_all_marts';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := TRUE;
        detail := marts_summary;
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        finished_at := clock_timestamp();
        step_name := 'marts.refresh_all_marts';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := FALSE;
        detail := SQLERRM;
        RETURN NEXT;
    END;

    -- Paso 4 (V217): compute_kpis_punto_equilibrio(periodo)
    -- Pobla los 10 KPIs pe_* en fact_kpis_mensuales + metadata de calidad.
    -- Idempotente via ON CONFLICT DO UPDATE SET.
    -- Si p_periodo IS NULL (refresh global), se skippea para no recalcular
    -- todo el histórico — los periodos pasados ya fueron poblados por las
    -- migraciones V214/V215/V216.
    started_at := clock_timestamp();
    IF p_periodo IS NULL THEN
        finished_at := clock_timestamp();
        step_name := 'marts.compute_kpis_punto_equilibrio';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := TRUE;
        detail := 'SKIPPED (p_periodo IS NULL — refresh global no recalcula PE histórico)';
        RETURN NEXT;
    ELSE
        BEGIN
            SELECT COUNT(*) INTO pe_entidades
            FROM marts.compute_kpis_punto_equilibrio(p_periodo);
            finished_at := clock_timestamp();
            step_name := 'marts.compute_kpis_punto_equilibrio';
            duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
            success := TRUE;
            detail := format('entidades=%s periodo=%s', pe_entidades, p_periodo);
            RETURN NEXT;
        EXCEPTION WHEN OTHERS THEN
            finished_at := clock_timestamp();
            step_name := 'marts.compute_kpis_punto_equilibrio';
            duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
            success := FALSE;
            detail := SQLERRM;
            RETURN NEXT;
        END;
    END IF;
END;
$$;

COMMENT ON FUNCTION marts.refresh_all_derived(INT, BOOLEAN) IS
    'V217: dw.recalcular_microfinancieras(p) + marts.refresh_kpis_anuales + '
    'marts.refresh_all_marts(c) + marts.compute_kpis_punto_equilibrio(p). '
    'Ejecuta en orden y devuelve el estado de cada paso. Idempotente.';
