-- =========================================================================
-- V128: Materializar marts.v_mora_global_historica y v_cobertura_car_historica
--
-- ROOT CAUSE:
-- v_mora_global_historica es un VIEW (no materializada) con multi-LEFT-JOIN
-- a v_castigos_12m_historica + v_venta_cartera_12m_historica. Cada query
-- re-evalua los 3 views = subqueries pesadas que escanean
-- raw.colocaciones_observacion y raw.castigos_observacion completos.
--
-- Sintoma: las accordions de Mora / Mora v/c / Cartera Atrasada / CAR
-- en /dashboard/informe colgaban en timeout 15s. Cada accordion era una
-- request HTTP separada que disparaba la query pesada.
--
-- Para v_cobertura_car_historica aplica similar (multi-join + computo).
--
-- FIX:
-- Crear MVs y reescribir los views como "passthrough" a la MV. Asi todas
-- las queries existentes contra v_* siguen funcionando, pero el computo
-- ocurre solo cuando se refresca la MV (post-ingest mensual).
--
-- IMPORTANTE — WITH NO DATA:
-- Las MVs se crean VACIAS para que la migracion sea instantanea. El
-- primer refresh (que es la operacion pesada de 30-90s) hay que
-- dispararlo MANUALMENTE despues del deploy via:
--     POST /api/v1/admin/refresh-mvs
-- o por SQL: SELECT marts.refresh_mvs_informe();
--
-- Razon: si el CREATE MATERIALIZED VIEW materializa al crearse, la
-- migracion tarda >2 min y el healthcheck del container (--start-period=60s
-- + 3 retries x 30s = 150s) mata el container antes de terminar,
-- generando zombies en pg_stat_activity y deadlocks.
--
-- Refresh: agregar al cron post-ingest junto con los otros REFRESH MV.
-- =========================================================================

-- ---------- Mora Global ----------
DROP MATERIALIZED VIEW IF EXISTS marts.mv_mora_global_historica CASCADE;

CREATE MATERIALIZED VIEW marts.mv_mora_global_historica AS
SELECT
    col.periodo,
    col.nomb_correg,
    col.cartera_bruta,
    col.cartera_atrasada,
    col.cartera_refin,
    COALESCE(cas.castigos_12m, 0::numeric)        AS castigos_12m,
    COALESCE(vc.venta_cartera_12m, 0::numeric)    AS venta_cartera_12m,
    CASE
        WHEN col.cartera_bruta > 0
        THEN ROUND(
            (col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
            / col.cartera_bruta,
            6
        )
        ELSE NULL
    END AS pct_mora_global,
    CASE
        WHEN col.cartera_bruta > 0
        THEN ROUND(
            (col.cartera_atrasada + col.cartera_refin
             + COALESCE(cas.castigos_12m, 0)
             + COALESCE(vc.venta_cartera_12m, 0))
            / col.cartera_bruta,
            6
        )
        ELSE NULL
    END AS pct_mora_global_vc
FROM marts.v_cartera_balance_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m_historica vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_mora_global_uniq
    ON marts.mv_mora_global_historica (periodo, nomb_correg);
CREATE INDEX idx_mv_mora_global_periodo
    ON marts.mv_mora_global_historica (periodo);
CREATE INDEX idx_mv_mora_global_nomb
    ON marts.mv_mora_global_historica (nomb_correg);

COMMENT ON MATERIALIZED VIEW marts.mv_mora_global_historica IS
    'Materializacion de v_mora_global_historica. El view original era multi-'
    'LEFT-JOIN pesado que disparaba timeouts. Refrescar via '
    'REFRESH MATERIALIZED VIEW CONCURRENTLY marts.mv_mora_global_historica '
    'despues de cada ingest EEFF + colocaciones.';

-- Recrear el VIEW como passthrough para que getInformeData no rompa.
CREATE OR REPLACE VIEW marts.v_mora_global_historica AS
    SELECT * FROM marts.mv_mora_global_historica;

COMMENT ON VIEW marts.v_mora_global_historica IS
    'Wrapper que apunta a la MV mv_mora_global_historica (V128). El nombre '
    'antiguo se preserva para compatibilidad con queries existentes.';


-- ---------- Cobertura CAR ----------
-- Mismo patron: la version no consolidada tambien es lenta.
-- Solo creamos MV si el view existia previamente (idempotente).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'marts' AND c.relname = 'v_cobertura_car_historica' AND c.relkind = 'v'
    ) THEN
        DROP MATERIALIZED VIEW IF EXISTS marts.mv_cobertura_car_historica CASCADE;
        EXECUTE 'CREATE MATERIALIZED VIEW marts.mv_cobertura_car_historica AS
                 SELECT * FROM marts.v_cobertura_car_historica
                 WITH NO DATA';
        EXECUTE 'CREATE UNIQUE INDEX idx_mv_cobertura_car_uniq
                 ON marts.mv_cobertura_car_historica (periodo, nomb_correg)';
        EXECUTE 'CREATE INDEX idx_mv_cobertura_car_periodo
                 ON marts.mv_cobertura_car_historica (periodo)';
        -- Recrear el VIEW como passthrough
        EXECUTE 'CREATE OR REPLACE VIEW marts.v_cobertura_car_historica AS
                 SELECT * FROM marts.mv_cobertura_car_historica';
    END IF;
END $$;


-- =========================================================================
-- Funcion de refresh agrupado: llamar despues de cada ingest mensual
-- para mantener las MVs al dia.
-- =========================================================================
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
            'marts.mv_cobertura_car_historica'
        ])
    LOOP
        BEGIN
            -- Solo procesar si la MV existe.
            schema_name := split_part(target, '.', 1);
            matview_name := split_part(target, '.', 2);
            SELECT ispopulated INTO is_populated
            FROM pg_matviews
            WHERE schemaname = schema_name AND matviewname = matview_name;

            IF is_populated IS NULL THEN
                -- MV no existe, saltar.
                mv_name := target;
                refreshed_at := now();
                success := FALSE;
                error := 'MV no existe';
                RETURN NEXT;
                CONTINUE;
            END IF;

            -- Primera vez (MV vacia tras CREATE WITH NO DATA): refresh
            -- NO concurrente (CONCURRENTLY requiere MV ya poblada).
            -- Despues siempre CONCURRENTLY para no bloquear lecturas.
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
    'Refresca las MVs del informe (mora, cobertura CAR). Detecta si la MV '
    'esta vacia (primera vez tras CREATE WITH NO DATA) y usa REFRESH normal; '
    'caso contrario usa CONCURRENTLY para no bloquear lecturas. '
    'Llamar despues de ingest mensual de EEFF.';

-- NOTA: el primer refresh NO se hace en la migracion (es pesado, ~60s,
-- generaba zombies cuando el healthcheck mataba el container). Despues
-- del deploy hay que disparar manualmente:
--     POST /api/v1/admin/refresh-mvs    (endpoint admin)
-- o desde psql:
--     SELECT marts.refresh_mvs_informe();
