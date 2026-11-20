-- =========================================================================
-- V223: refresh_kpis_anuales acepta CONCURRENTLY — fin del lock
--        exclusivo que bloqueaba dashboards durante ingesta
--
-- Bug diagnosticado 2026-11-20:
--   El dashboard /dashboard/informe y /dashboard/dupont mostraban
--   "Cargando..." indefinido durante ingestas. El SSR timeaba a los 45s
--   (statement_timeout del pool) porque las queries esperaban lock sobre
--   mv_kpis_anuales_entidad.
--
-- Root cause:
--   La cadena de refresh era:
--     refresh_all_derived_logged(periodo, concurrent, triggered_by)
--       -> refresh_all_derived(periodo, concurrent)
--         -> refresh_kpis_anuales()  <-- HARDCODE sin flag
--
--   V090 definio refresh_kpis_anuales() sin argumentos:
--     REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_entidad;
--     REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_historica;
--
--   REFRESH sin CONCURRENTLY toma AccessExclusiveLock -> todos los reads
--   sobre esas MVs quedan bloqueados mientras dure (10-18 min por MV).
--   Por mas que el caller pase concurrent=TRUE, este step siempre bloquea.
--
-- Fix:
--   1. Nueva firma: refresh_kpis_anuales(p_concurrent BOOLEAN DEFAULT TRUE)
--      que decide dinamicamente si usar CONCURRENTLY. Fallback a NO
--      concurrent si la MV no esta populada (REQUISITO de CONCURRENTLY)
--      o no tiene unique index.
--   2. Mantener refresh_kpis_anuales() (sin args) como wrapper que llama
--      a la version nueva con TRUE — backward compatibility + mejora
--      silenciosa para cualquier caller legacy.
--   3. Actualizar refresh_all_derived para pasar p_concurrent al step 2.
--
-- Ambas MVs (mv_kpis_anuales_entidad, mv_kpis_anuales_historica) ya tienen
-- unique index (mv_kpis_anuales_pk, mv_kpis_anuales_hist_pk), verificado
-- 2026-11-20. CONCURRENTLY es aplicable sin cambios estructurales.
--
-- IDEMPOTENTE: CREATE OR REPLACE. La firma con parametro no colisiona con
-- la sin parametros (sobrecarga permitida en PL/pgSQL).
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. refresh_kpis_anuales CON parametro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.refresh_kpis_anuales(p_concurrent BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_mv TEXT;
    v_is_populated BOOLEAN;
    v_has_uniq BOOLEAN;
    v_use_concurrent BOOLEAN;
BEGIN
    FOREACH v_mv IN ARRAY ARRAY['mv_kpis_anuales_entidad','mv_kpis_anuales_historica']
    LOOP
        SELECT ispopulated INTO v_is_populated
          FROM pg_matviews
         WHERE schemaname='marts' AND matviewname=v_mv;

        IF v_is_populated IS NULL THEN
            -- MV no existe: omitir silenciosamente (puede estar en proceso
            -- de crearse via otra migration).
            CONTINUE;
        END IF;

        SELECT EXISTS(
            SELECT 1
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = v_mv
               AND n.nspname = 'marts'
               AND i.indisunique
        ) INTO v_has_uniq;

        -- CONCURRENTLY requiere: (a) flag TRUE, (b) MV populada, (c) unique index.
        v_use_concurrent := p_concurrent AND v_is_populated AND v_has_uniq;

        IF v_use_concurrent THEN
            EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY marts.%I', v_mv);
        ELSE
            EXECUTE format('REFRESH MATERIALIZED VIEW marts.%I', v_mv);
        END IF;
    END LOOP;

    RETURN 'OK';
END $$;

COMMENT ON FUNCTION marts.refresh_kpis_anuales(BOOLEAN) IS
    'Refresca mv_kpis_anuales_entidad + mv_kpis_anuales_historica. Con '
    'p_concurrent=TRUE usa REFRESH MATERIALIZED VIEW CONCURRENTLY, '
    'permitiendo lecturas en paralelo (no bloquea dashboards). V223.';

-- ---------------------------------------------------------------------------
-- 2. refresh_kpis_anuales() SIN parametro — wrapper legacy con default TRUE
--    (antes era no-concurrent; cambiamos default para que todo caller
--    legacy obtenga el comportamiento no bloqueante por default).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.refresh_kpis_anuales()
RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
    RETURN marts.refresh_kpis_anuales(TRUE);
END $$;

COMMENT ON FUNCTION marts.refresh_kpis_anuales() IS
    'Wrapper legacy sin argumentos. Equivalente a '
    'refresh_kpis_anuales(TRUE) — CONCURRENTLY por default. V223.';

-- ---------------------------------------------------------------------------
-- 3. refresh_all_derived — propagar p_concurrent al step 2
--    Antes: PERFORM marts.refresh_kpis_anuales();
--    Ahora: PERFORM marts.refresh_kpis_anuales(p_concurrent);
-- ---------------------------------------------------------------------------
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

    -- Paso 2: refresh_kpis_anuales — V223 FIX: propagar p_concurrent.
    -- Antes se llamaba sin args y hardcodeaba REFRESH no-concurrent,
    -- bloqueando dashboards durante 10-18 min cada ingesta.
    started_at := clock_timestamp();
    BEGIN
        PERFORM marts.refresh_kpis_anuales(p_concurrent);
        finished_at := clock_timestamp();
        step_name := 'marts.refresh_kpis_anuales';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := TRUE;
        detail := format('concurrent=%s', p_concurrent);
        RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
        finished_at := clock_timestamp();
        step_name := 'marts.refresh_kpis_anuales';
        duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
        success := FALSE;
        detail := SQLERRM;
        RETURN NEXT;
    END;

    -- Paso 3: refresh_all_marts (las 24 MVs marts.*) — ya respeta p_concurrent.
    started_at := clock_timestamp();
    BEGIN
        SELECT
            format('OK=%s FAIL=%s concurrent=%s',
                   COUNT(*) FILTER (WHERE r.success),
                   COUNT(*) FILTER (WHERE NOT r.success),
                   p_concurrent)
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

    RETURN;
END $$;

COMMENT ON FUNCTION marts.refresh_all_derived(INT, BOOLEAN) IS
    'Orquesta todos los recalculos derivados post-import. V223: propaga '
    'p_concurrent al step refresh_kpis_anuales (antes se perdia). Con '
    'p_concurrent=TRUE, ninguno de los 3 steps bloquea lecturas del '
    'dashboard.';
