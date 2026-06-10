-- =========================================================================
-- V134: Funcion marts.refresh_all_derived(periodo) — orquesta TODOS los
-- recalculos derivados tras un import.
--
-- Bug raiz descubierto al cargar abril 2026: la columna "Cartera MYPE / Total"
-- aparecio vacia en el Benchmark aunque raw.colocaciones_observacion tenia la
-- data, porque dw.entidad_microfinanciera_periodo se calcula via
-- dw.recalcular_microfinancieras() que JAMAS se llamaba post-import.
--
-- Inventario de funciones de recalculo encontradas:
--   1. dw.recalcular_microfinancieras(p) — pobla entidad_microfinanciera_periodo
--      desde raw.colocaciones_observacion. Requiere llamada explicita por
--      periodo. Sin esto, MYPE/SMF queda NULL en el informe.
--   2. marts.refresh_kpis_anuales() — refresca mv_kpis_anuales_entidad +
--      mv_kpis_anuales_historica (sin args, refresca todos los periodos
--      disponibles, idempotente).
--   3. marts.refresh_all_marts(p_concurrent) — refresca las 24 MVs marts
--      en orden topologico (creada en V133).
--
-- Otras funciones existentes (NO usadas porque dependen de MVs que ya no
-- existen, marcadas como legacy):
--   - marts.refresh_cuadro_resumen() — referencia marts.mv_cuadro_resumen_canonico
--     que no existe. Dejarla rota hasta que alguien la limpie. Ver issue futuro.
--   - marts.refresh_mvs_informe() — subset cubierto por refresh_all_marts.
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
BEGIN
    -- Paso 1: recalcular_microfinancieras(periodo)
    -- Si p_periodo IS NULL, la funcion recalcula TODO el historico — caro.
    -- Por eso requerimos p_periodo explicito para post-import.
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

    -- Paso 2: refresh_kpis_anuales (idempotente, sin args)
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

    -- Paso 3: refresh_all_marts (las 24 MVs marts.*)
    -- NO usamos CONCURRENTLY por default — es 10x mas lento en MVs grandes
    -- (mv_eeff_balance_ancho tarda 15+ min con CONCURRENTLY vs <1min sin).
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
END;
$$;

COMMENT ON FUNCTION marts.refresh_all_derived(INT, BOOLEAN) IS
    'Orquesta TODOS los recalculos derivados tras un import: '
    'dw.recalcular_microfinancieras(p) + marts.refresh_kpis_anuales + '
    'marts.refresh_all_marts(concurrent). Retorna fila por paso con '
    'duration_ms, success, detail. Idempotente. '
    'p_periodo=NULL recalcula TODO el historico (caro, evitar en cron). '
    'p_concurrent=FALSE (default) para velocidad en MVs grandes.';
