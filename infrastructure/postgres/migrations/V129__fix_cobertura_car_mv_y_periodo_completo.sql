-- =========================================================================
-- V129: Fix bug critico en V128 (cobertura_car MV con referencia circular)
--       + funcion f_ultimo_periodo_completo (smart period default)
--
-- BUG en V128:
-- El MV mv_cobertura_car_historica se creo con la query
--   "SELECT * FROM marts.v_cobertura_car_historica"
-- pero el VIEW v_cobertura_car_historica luego fue reescrito como
-- passthrough al MV. Resultado: referencia circular, MV nunca se puebla
-- aunque se haga REFRESH.
--
-- FIX: recrear el MV con la definicion ORIGINAL del view (V070):
--   SELECT periodo, raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
--          SUM(cta_a4_2), SUM(cta_a4_3), SUM(ABS(cta_a4_4)),
--          pct_cobertura_car
--   FROM marts.v_eeff_balance_ancho
--   WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
--   GROUP BY ...
--
-- SMART PERIOD DEFAULT:
-- listPeriodosDisponibles selecciona el ultimo periodo con data en
-- mv_eeff_resultados_ancho. Pero SBS publica los archivos con lag:
-- EEFF puede estar publicado para Abr 2026 pero colocaciones/depositos
-- todavia no. Resultado: dashboard muestra Abr 2026 con accordions vacias.
--
-- FIX: marts.f_ultimo_periodo_completo() = ultimo periodo donde NO hay
-- archivos con status='no_publicado_sbs' en raw.archivos_descargados.
-- =========================================================================

-- ============================================================================
-- 1. FIX cobertura_car MV (recrear con query correcta)
-- ============================================================================

-- Drop el VIEW passthrough roto (CASCADE para limpiar deps)
DROP VIEW IF EXISTS marts.v_cobertura_car_historica CASCADE;
DROP MATERIALIZED VIEW IF EXISTS marts.mv_cobertura_car_historica CASCADE;

-- Crear MV con la definicion ORIGINAL del view (V070 line 142-154)
CREATE MATERIALIZED VIEW marts.mv_cobertura_car_historica AS
SELECT
    b.periodo,
    dw.raw_to_vigente(b.nomb_correg, b.periodo) AS nomb_correg,
    SUM(b.cta_a4_2)       AS cartera_refinanciada,
    SUM(b.cta_a4_3)       AS cartera_atrasada,
    SUM(ABS(b.cta_a4_4))  AS provisiones,
    CASE WHEN SUM(b.cta_a4_2 + b.cta_a4_3) > 0
         THEN ROUND(
             (SUM(ABS(b.cta_a4_4)) / SUM(b.cta_a4_2 + b.cta_a4_3))::numeric,
             6
         )
         ELSE NULL
    END AS pct_cobertura_car
FROM marts.v_eeff_balance_ancho b
WHERE b.moneda = 'TOTAL' AND b.nomb_correg IS NOT NULL
GROUP BY b.periodo, dw.raw_to_vigente(b.nomb_correg, b.periodo)
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_cobertura_car_uniq
    ON marts.mv_cobertura_car_historica (periodo, nomb_correg);
CREATE INDEX idx_mv_cobertura_car_periodo
    ON marts.mv_cobertura_car_historica (periodo);
CREATE INDEX idx_mv_cobertura_car_nomb
    ON marts.mv_cobertura_car_historica (nomb_correg);

COMMENT ON MATERIALIZED VIEW marts.mv_cobertura_car_historica IS
    'Materializacion de cobertura CAR (provisiones / cartera de alto riesgo). '
    'Definicion original en V070, fix de referencia circular en V129. '
    'Refrescar via marts.refresh_mvs_informe() despues de cada ingest EEFF.';

-- Recrear el VIEW como passthrough (ahora SI puede ser passthrough porque
-- el MV ya tiene su propia query independiente del view)
CREATE OR REPLACE VIEW marts.v_cobertura_car_historica AS
    SELECT * FROM marts.mv_cobertura_car_historica;

COMMENT ON VIEW marts.v_cobertura_car_historica IS
    'Wrapper que apunta a la MV mv_cobertura_car_historica (V129 fix). '
    'El nombre antiguo se preserva para compatibilidad con queries existentes.';


-- ============================================================================
-- 2. f_ultimo_periodo_completo: smart period default
-- ============================================================================

CREATE OR REPLACE FUNCTION marts.f_ultimo_periodo_completo()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    -- Ultimo periodo donde NO hay archivos con status='no_publicado_sbs'.
    -- Si todos los periodos tienen al menos un archivo no publicado,
    -- cae al ultimo periodo de mv_eeff_resultados_ancho (best-effort).
    WITH periodos_incompletos AS (
        SELECT DISTINCT periodo
        FROM raw.archivos_descargados
        WHERE status = 'no_publicado_sbs'
    ),
    periodos_disponibles AS (
        SELECT DISTINCT periodo
        FROM marts.mv_eeff_resultados_ancho
        WHERE periodo NOT IN (SELECT periodo FROM periodos_incompletos)
    )
    SELECT COALESCE(
        (SELECT MAX(periodo) FROM periodos_disponibles),
        (SELECT MAX(periodo) FROM marts.mv_eeff_resultados_ancho)
    );
$$;

COMMENT ON FUNCTION marts.f_ultimo_periodo_completo IS
    'Devuelve el ultimo periodo donde TODOS los archivos SBS estan publicados '
    '(no hay ningun archivo con status=no_publicado_sbs). Usado como default '
    'del Benchmark cuando no se especifica periodo en la URL.';


-- ============================================================================
-- 3. Auto-refresh helper: refrescar MVs cuando esten vacias
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
    -- Solo procesa MVs que estan VACIAS (ispopulated = false). Si ya tiene
    -- data, no toca nada. Sirve para auto-poblar despues de un deploy fresh
    -- sin esperar que el admin corra refresh_mvs_informe manualmente.
    FOR target IN
        SELECT unnest(ARRAY[
            'marts.mv_mora_global_historica',
            'marts.mv_cobertura_car_historica'
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

COMMENT ON FUNCTION marts.ensure_mvs_pobladas IS
    'Refresca solo las MVs vacias (post-deploy fresh). No toca las que ya '
    'tienen data. Util como auto-heal cuando se aplica V129 y las MVs '
    'quedaron vacias por el bug de V128.';
