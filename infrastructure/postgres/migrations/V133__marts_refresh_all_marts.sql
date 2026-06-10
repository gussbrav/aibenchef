-- =========================================================================
-- V133: Funcion marts.refresh_all_marts() para refrescar TODAS las MVs marts.
--
-- Por que: tras `aibenchef sbs work-jobs` (scrape + import all-monthly), las
-- tablas raw.* quedan actualizadas pero las MVs marts.* siguen con el
-- snapshot anterior. El dashboard (Resumen, Benchmark, EEFF, Acumulado)
-- lee de las MVs y muestra el periodo viejo aunque la data nueva ya este
-- en raw.
--
-- Lo existente (`marts.refresh_mvs_informe()`) solo cubre 8 MVs del informe.
-- Faltaban las principales: eeff_balance, eeff_resultados, eeff_ratios,
-- indicadores_prudenciales, kpis_anuales, colocaciones, castigos, depositos,
-- clientes, personal, tasas. Esta funcion las cubre todas (24).
--
-- Issue raiz: caso real 2026-06-09 — abril 2026 procesado en raw pero
-- dashboard muestra Marzo 2026 como ultimo cierre. Refs continuacion #126.
-- =========================================================================

CREATE OR REPLACE FUNCTION marts.refresh_all_marts(
    p_concurrent BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    mv_name TEXT,
    duration_ms INT,
    success BOOLEAN,
    error TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    -- Orden topologico aproximado: refrescamos primero las MVs que dependen
    -- solo de raw.*, luego las derivadas. Si CONCURRENTLY = false, el orden
    -- no importa para correctitud pero igual mantiene patron predecible.
    --
    -- Tier 1 — dependen solo de raw.*:
    --   castigos_resumen, depositos_resumen, clientes_resumen,
    --   personal_resumen, indicadores_prudenciales, tasas_*, creditos_distrito,
    --   cobertura_geografica, eeff_balance_ancho, eeff_resultados_ancho,
    --   colocaciones_resumen, *_por_entidad_historica.
    --
    -- Tier 2 — dependen de Tier 1:
    --   eeff_ratios (de balance + resultados),
    --   colocaciones_por_tipo (de colocaciones_resumen),
    --   kpis_anuales_* (de eeff_resultados_ancho),
    --   *_por_entidad_canonico (de raw + v_*).
    --
    -- Tier 3 — dependen de Tier 2:
    --   cobertura_car_historica (de v_eeff_balance_ancho),
    --   mora_global_historica (de varias vistas v_*).
    targets TEXT[] := ARRAY[
        -- Tier 1
        'marts.mv_eeff_balance_ancho',
        'marts.mv_eeff_resultados_ancho',
        'marts.mv_indicadores_prudenciales',
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
        -- Tier 2
        'marts.mv_eeff_ratios',
        'marts.mv_colocaciones_por_tipo',
        'marts.mv_kpis_anuales_entidad',
        'marts.mv_kpis_anuales_historica',
        'marts.mv_clientes_por_entidad_canonico',
        'marts.mv_oficinas_por_entidad_canonico',
        'marts.mv_personal_por_entidad_canonico',
        -- Tier 3
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

            SELECT ispopulated INTO is_populated
              FROM pg_matviews
             WHERE schemaname = schema_name AND matviewname = matview_name;

            IF is_populated IS NULL THEN
                mv_name := target;
                duration_ms := 0;
                success := FALSE;
                error := 'MV no existe';
                RETURN NEXT;
                CONTINUE;
            END IF;

            -- CONCURRENTLY requiere unique index Y que la MV ya este populada.
            SELECT EXISTS(
                SELECT 1
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = matview_name
                   AND n.nspname = schema_name
                   AND i.indisunique
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
            success := TRUE;
            error := NULL;
            RETURN NEXT;
        EXCEPTION WHEN OTHERS THEN
            finished_at := clock_timestamp();
            mv_name := target;
            duration_ms := EXTRACT(EPOCH FROM (finished_at - started_at))::int * 1000;
            success := FALSE;
            error := SQLERRM;
            RETURN NEXT;
        END;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION marts.refresh_all_marts(BOOLEAN) IS
    'Refresca las 24 MVs marts.* en orden topologico. Si p_concurrent=true '
    '(default) usa CONCURRENTLY donde sea posible (no bloquea reads pero '
    'es lento en MVs grandes). p_concurrent=false hace REFRESH normal '
    '(rapido, bloquea reads brevemente). Devuelve una fila por MV con '
    'duration_ms, success, error. Usado por aibenchef pipeline refresh-marts.';
