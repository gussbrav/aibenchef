-- =========================================================================
-- V130: Materializar vistas de oficinas, personal, clientes (canonico + historica)
--
-- BUG: las accordions "N° de Oficinas", "N° de Personal", "N° de Clientes"
-- en /dashboard/informe daban timeout 15s. Los views correspondientes hacen
-- subqueries con UDFs (dw.resolver_nomb_correg_canonico, dw.limpiar_nombre_raw)
-- por fila contra raw.creditos_depositos_oficina (millones de filas), mas
-- joins a dw.entidad_nombre + dw.entidad_maestra. Cada query del usuario
-- recomputa todo el join.
--
-- FIX: materializar las 6 vistas (oficinas/personal/clientes × canonico/historica)
-- usando pg_get_viewdef para capturar la definicion ORIGINAL del view (evita
-- el bug de V128 cobertura_car donde el MV terminaba referenciando al view
-- passthrough creando una referencia circular).
--
-- WITH NO DATA para que la migracion sea instantanea. Primer refresh manual
-- via marts.refresh_mvs_informe() despues del deploy.
-- =========================================================================

-- Helper plpgsql para materializar un view con captura de definicion.
-- Pattern: capturar def -> drop view -> create MV con la def -> indices ->
-- create OR replace view como passthrough.
CREATE OR REPLACE FUNCTION marts.fn_materialize_view_idempotent(
    view_full_name TEXT,
    create_unique_index BOOLEAN DEFAULT TRUE
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    schema_name TEXT;
    view_name TEXT;
    mv_name TEXT;
    view_def TEXT;
    obj_relkind CHAR;
BEGIN
    schema_name := split_part(view_full_name, '.', 1);
    view_name := split_part(view_full_name, '.', 2);
    mv_name := schema_name || '.mv_' || substring(view_name FROM 3); -- v_xxx -> mv_xxx

    -- Verificar si existe y de que tipo (view o mv)
    SELECT c.relkind INTO obj_relkind
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = schema_name AND c.relname = view_name;

    IF obj_relkind IS NULL THEN
        RAISE NOTICE 'Objeto % no existe, skip', view_full_name;
        RETURN;
    END IF;

    -- Si ya es MV con su passthrough, considerar ya migrado
    IF obj_relkind = 'm' THEN
        RAISE NOTICE 'Objeto % ya es materialized view, skip', view_full_name;
        RETURN;
    END IF;

    -- Capturar la definicion del view ORIGINAL
    SELECT pg_get_viewdef(view_full_name::regclass, true) INTO view_def;
    IF view_def IS NULL OR view_def = '' THEN
        RAISE NOTICE 'No se pudo capturar definicion de %, skip', view_full_name;
        RETURN;
    END IF;

    -- FIX CRITICO: pg_get_viewdef retorna la def con ';' final.
    -- Si no lo stripeamos, queda 'CREATE MV ... AS <def>; WITH NO DATA' que
    -- es SQL invalido (el ';' termina el CREATE y WITH NO DATA queda huerfano).
    view_def := rtrim(view_def, E' ;\n\r\t');

    -- Limpiar MV vieja (si existia de un intento previo)
    EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %s CASCADE', mv_name);
    -- Limpiar view (CASCADE para dependencias downstream)
    EXECUTE format('DROP VIEW IF EXISTS %s CASCADE', view_full_name);

    -- Crear MV con la definicion ORIGINAL (no passthrough, no circular)
    EXECUTE format('CREATE MATERIALIZED VIEW %s AS %s WITH NO DATA', mv_name, view_def);

    -- Indices: unique en (periodo, nomb_correg) + periodo solo
    IF create_unique_index THEN
        BEGIN
            EXECUTE format(
                'CREATE UNIQUE INDEX ON %s (periodo, nomb_correg)',
                mv_name
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'No se pudo crear unique index en %: %', mv_name, SQLERRM;
        END;
    END IF;
    BEGIN
        EXECUTE format('CREATE INDEX ON %s (periodo)', mv_name);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo crear index periodo en %: %', mv_name, SQLERRM;
    END;

    -- Recrear el view como passthrough
    EXECUTE format(
        'CREATE OR REPLACE VIEW %s AS SELECT * FROM %s',
        view_full_name,
        mv_name
    );

    RAISE NOTICE 'Materializado: % -> % (vacio, falta refresh)', view_full_name, mv_name;
END $$;

COMMENT ON FUNCTION marts.fn_materialize_view_idempotent IS
    'Helper para convertir un VIEW en MATERIALIZED VIEW + passthrough sin '
    'caer en referencia circular. Captura la definicion original via '
    'pg_get_viewdef antes de drop. Idempotente: si ya es MV, no hace nada.';


-- ============================================================================
-- Materializar las 6 vistas
-- ============================================================================

DO $$
DECLARE
    targets TEXT[] := ARRAY[
        'marts.v_oficinas_por_entidad_canonico',
        'marts.v_oficinas_por_entidad_historica',
        'marts.v_personal_por_entidad_canonico',
        'marts.v_personal_por_entidad_historica',
        'marts.v_clientes_por_entidad_canonico',
        'marts.v_clientes_por_entidad_historica'
    ];
    target TEXT;
BEGIN
    FOREACH target IN ARRAY targets LOOP
        PERFORM marts.fn_materialize_view_idempotent(target, TRUE);
    END LOOP;
END $$;


-- ============================================================================
-- Actualizar refresh_mvs_informe() para incluir las 6 MVs nuevas
-- ============================================================================

CREATE OR REPLACE FUNCTION marts.refresh_mvs_informe()
RETURNS TABLE (mv_name TEXT, refreshed_at TIMESTAMPTZ, success BOOLEAN, error TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    target TEXT;
    schema_name TEXT;
    matview_name TEXT;
    is_populated BOOLEAN;
BEGIN
    FOR target IN
        SELECT unnest(ARRAY[
            'marts.mv_mora_global_historica',
            'marts.mv_cobertura_car_historica',
            'marts.mv_oficinas_por_entidad_canonico',
            'marts.mv_oficinas_por_entidad_historica',
            'marts.mv_personal_por_entidad_canonico',
            'marts.mv_personal_por_entidad_historica',
            'marts.mv_clientes_por_entidad_canonico',
            'marts.mv_clientes_por_entidad_historica'
        ])
    LOOP
        BEGIN
            schema_name := split_part(target, '.', 1);
            matview_name := split_part(target, '.', 2);
            SELECT ispopulated INTO is_populated
            FROM pg_matviews
            WHERE schemaname = schema_name AND matviewname = matview_name;

            IF is_populated IS NULL THEN
                mv_name := target;
                refreshed_at := now();
                success := FALSE;
                error := 'MV no existe';
                RETURN NEXT;
                CONTINUE;
            END IF;

            IF is_populated THEN
                EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %s', target);
            ELSE
                EXECUTE format('REFRESH MATERIALIZED VIEW %s', target);
            END IF;

            mv_name := target;
            refreshed_at := now();
            success := TRUE;
            error := NULL;
            RETURN NEXT;
        EXCEPTION WHEN OTHERS THEN
            mv_name := target;
            refreshed_at := now();
            success := FALSE;
            error := SQLERRM;
            RETURN NEXT;
        END;
    END LOOP;
END $$;

COMMENT ON FUNCTION marts.refresh_mvs_informe IS
    'Refresca las MVs del informe (mora, cobertura, oficinas, personal, '
    'clientes). Smart: primera vez (no populated) usa REFRESH normal, '
    'siguientes usan CONCURRENTLY. Llamar despues de cada ingest mensual.';


-- ============================================================================
-- Tambien actualizar ensure_mvs_pobladas()
-- ============================================================================

CREATE OR REPLACE FUNCTION marts.ensure_mvs_pobladas()
RETURNS TABLE (mv_name TEXT, was_empty BOOLEAN, refreshed BOOLEAN, error TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    target TEXT;
    schema_name TEXT;
    matview_name TEXT;
    is_populated BOOLEAN;
BEGIN
    FOR target IN
        SELECT unnest(ARRAY[
            'marts.mv_mora_global_historica',
            'marts.mv_cobertura_car_historica',
            'marts.mv_oficinas_por_entidad_canonico',
            'marts.mv_oficinas_por_entidad_historica',
            'marts.mv_personal_por_entidad_canonico',
            'marts.mv_personal_por_entidad_historica',
            'marts.mv_clientes_por_entidad_canonico',
            'marts.mv_clientes_por_entidad_historica'
        ])
    LOOP
        schema_name := split_part(target, '.', 1);
        matview_name := split_part(target, '.', 2);

        SELECT ispopulated INTO is_populated
        FROM pg_matviews
        WHERE schemaname = schema_name AND matviewname = matview_name;

        IF is_populated IS NULL THEN
            mv_name := target;
            was_empty := FALSE;
            refreshed := FALSE;
            error := 'MV no existe';
            RETURN NEXT;
            CONTINUE;
        END IF;

        IF NOT is_populated THEN
            BEGIN
                EXECUTE format('REFRESH MATERIALIZED VIEW %s', target);
                mv_name := target;
                was_empty := TRUE;
                refreshed := TRUE;
                error := NULL;
                RETURN NEXT;
            EXCEPTION WHEN OTHERS THEN
                mv_name := target;
                was_empty := TRUE;
                refreshed := FALSE;
                error := SQLERRM;
                RETURN NEXT;
            END;
        ELSE
            mv_name := target;
            was_empty := FALSE;
            refreshed := FALSE;
            error := NULL;
            RETURN NEXT;
        END IF;
    END LOOP;
END $$;
