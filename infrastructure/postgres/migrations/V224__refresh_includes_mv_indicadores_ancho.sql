-- =========================================================================
-- V224: agregar marts.mv_indicadores_ancho al refresh automatico
--
-- Bug diagnosticado 2026-11-25:
--   La seccion "Calidad de Cartera" del /dashboard/informe mostraba el
--   empty state ("Sin datos oficiales SBS...") para 202608 y 202609
--   incluso con raw.indicadores_prudenciales ya ingestada hasta 202609.
--
-- Root cause:
--   marts.mv_indicadores_ancho fue creada en V156 y modificada CASCADE en
--   V184/V185/V187, pero nunca se agregó al array `targets` de
--   marts.refresh_all_marts(). La MV quedaba stale indefinidamente despues
--   de cada ingesta.
--
--   Afecta tambien a cualquier otra feature que consuma v_indicadores_ancho
--   (benchmarks DuPont, publicaciones de calidad_cartera/mora_global/
--   cartera_bruta).
--
-- Fix: recrear marts.refresh_all_marts() agregando 'marts.mv_indicadores_ancho'
--   al array targets. Idempotente — CREATE OR REPLACE.
-- =========================================================================

CREATE OR REPLACE FUNCTION marts.refresh_all_marts(p_concurrent boolean DEFAULT true)
    RETURNS TABLE(mv_name text, duration_ms integer, success boolean, error text)
    LANGUAGE plpgsql
AS $function$
DECLARE
    targets TEXT[] := ARRAY[
        'marts.mv_eeff_balance_ancho',
        'marts.mv_eeff_resultados_ancho',
        'marts.mv_indicadores_prudenciales',
        'marts.mv_indicadores_ancho',
        'marts.mv_colocaciones_resumen',
        'marts.mv_castigos_resumen',
        'marts.mv_depositos_resumen',
        'marts.mv_clientes_resumen',
        'marts.mv_personal_resumen',
        'marts.mv_tasas_activas_resumen',
        'marts.mv_tasas_pasivas_resumen',
        'marts.mv_creditos_distrito_long',
        'marts.mv_cobertura_geografica',
        'marts.mv_clientes_por_entidad_historica',
        'marts.mv_oficinas_por_entidad_historica',
        'marts.mv_personal_por_entidad_historica',
        'marts.mv_eeff_ratios',
        'marts.mv_colocaciones_por_tipo',
        'marts.mv_kpis_anuales_entidad',
        'marts.mv_kpis_anuales_historica',
        'marts.mv_clientes_por_entidad_canonico',
        'marts.mv_oficinas_por_entidad_canonico',
        'marts.mv_personal_por_entidad_canonico',
        'marts.mv_cobertura_car_historica',
        'marts.mv_mora_global_historica'
    ];
    target          TEXT;
    schema_name     TEXT;
    matview_name    TEXT;
    is_populated    BOOLEAN;
    has_uniq_idx    BOOLEAN;
    use_concurrent  BOOLEAN;
    started_at      TIMESTAMPTZ;
    finished_at     TIMESTAMPTZ;
BEGIN
    FOREACH target IN ARRAY targets LOOP
        started_at := clock_timestamp();
        BEGIN
            schema_name := split_part(target, '.', 1);
            matview_name := split_part(target, '.', 2);
            SELECT ispopulated INTO is_populated FROM pg_matviews
             WHERE schemaname = schema_name AND matviewname = matview_name;
            IF is_populated IS NULL THEN
                mv_name := target; duration_ms := 0; success := FALSE;
                error := 'MV no existe'; RETURN NEXT; CONTINUE;
            END IF;
            SELECT EXISTS(
                SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE c.relname=matview_name AND n.nspname=schema_name AND i.indisunique
            ) INTO has_uniq_idx;
            use_concurrent := p_concurrent AND is_populated AND has_uniq_idx;
            IF use_concurrent THEN
                EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %s', target);
            ELSE
                EXECUTE format('REFRESH MATERIALIZED VIEW %s', target);
            END IF;
            finished_at := clock_timestamp();
            mv_name := target;
            duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
            success := TRUE; error := NULL; RETURN NEXT;
        EXCEPTION WHEN OTHERS THEN
            finished_at := clock_timestamp();
            mv_name := target;
            duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
            success := FALSE; error := SQLERRM; RETURN NEXT;
        END;
    END LOOP;
END;
$function$;
