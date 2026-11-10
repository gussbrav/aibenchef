-- =========================================================================
-- V214: Fallback anualizado (YTD × 12/M) para compute_kpis_punto_equilibrio
--
-- PROBLEMA: entidades sin datos del año anterior (nombre nuevo, primer año
-- de reporte, o diciembre pendiente de publicacion) mostraban "—" en todos
-- sus periodos en la UI, incluso cuando SÍ tienen datos del año en curso.
--
-- SOLUCION: si falta ytd_dic_prev o ytd_mismo_mes_prev, en lugar de
-- devolver NULL devolvemos ytd_actual × (12 / mes). Esto es el metodo
-- estándar de "YTD annualized run-rate" usado en analisis financiero.
--
-- Precision:
--   - Dic (mes=12): ann = YTD × 1 = resultado exacto del año. Perfecto.
--   - Jun (mes=6):  ann = YTD × 2. Asume distribucion uniforme H1/H2.
--   - Mar (mes=3):  ann = YTD × 4. Asume distribucion uniforme.
--   - Sep (mes=9):  ann = YTD × 1.33.
--
-- La UI marcará periodos anualizados con "~" para que el usuario sepa que
-- es una estimacion, no el TTM exacto de 12 meses moviles.
--
-- Para el calculo el motor intenta TTM primero. Solo cae al fallback si
-- alguno de los dos periodos anteriores no existe en mv_eeff_resultados_ancho.
-- =========================================================================

-- -----------------------------------------------------------------------
-- 1. Actualizar ttm_resultados: agrega parametro _ann_fallback
--    DEFAULT FALSE para no romper calls existentes.
--    Se elimina la version de 4 parametros para evitar ambiguedad.
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS marts.ttm_resultados(INT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION marts.ttm_resultados(
    _periodo      INT,
    _nomb_correg  TEXT,
    _moneda       TEXT,
    _columna      TEXT,
    _ann_fallback BOOL DEFAULT FALSE
) RETURNS NUMERIC AS $$
DECLARE
    _anio               INT := _periodo / 100;
    _mes                INT := _periodo % 100;
    _ytd_actual         NUMERIC;
    _ytd_dic_prev       NUMERIC;
    _ytd_mismo_mes_prev NUMERIC;
    _query              TEXT;
BEGIN
    _query := format(
        'SELECT %I FROM marts.mv_eeff_resultados_ancho WHERE periodo=$1 AND nomb_correg=$2 AND moneda=$3',
        _columna
    );

    EXECUTE _query INTO _ytd_actual         USING _periodo, _nomb_correg, _moneda;
    EXECUTE _query INTO _ytd_dic_prev       USING ((_anio - 1) * 100 + 12), _nomb_correg, _moneda;
    EXECUTE _query INTO _ytd_mismo_mes_prev USING ((_anio - 1) * 100 + _mes), _nomb_correg, _moneda;

    -- Sin datos del periodo actual: no hay nada que calcular.
    IF _ytd_actual IS NULL THEN
        RETURN NULL;
    END IF;

    -- TTM exacto (caso ideal: ambos prior periods disponibles).
    IF _ytd_dic_prev IS NOT NULL AND _ytd_mismo_mes_prev IS NOT NULL THEN
        RETURN _ytd_actual + _ytd_dic_prev - _ytd_mismo_mes_prev;
    END IF;

    -- Fallback: YTD anualizado.
    IF _ann_fallback THEN
        RETURN _ytd_actual * 12 / _mes;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.ttm_resultados(INT, TEXT, TEXT, TEXT, BOOL) IS
    'TTM exacto si existen prior periods. Con _ann_fallback=TRUE devuelve YTD×12/mes como estimacion.';

-- -----------------------------------------------------------------------
-- 2. Actualizar compute_kpis_punto_equilibrio: usar _ann_fallback=TRUE
--    y eliminar el CONTINUE por NULL (V211) — ahora el NULL solo ocurre
--    si cta_1_4 del periodo actual es NULL (caso raro).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.compute_kpis_punto_equilibrio(_periodo INT)
RETURNS TABLE (entidad TEXT, kpis_insertados INT) AS $$
DECLARE
    _entidad   RECORD;
    _moneda    TEXT := 'TOTAL';
    _mes       INT  := _periodo % 100;
    _cartera_prom NUMERIC;
    _rendimiento NUMERIC;
    _costo_fondeo NUMERIC;
    _costo_provisiones NUMERIC;
    _gastos_op NUMERIC;
    _gastos_personal NUMERIC;
    _gastos_generales NUMERIC;
    _deprec NUMERIC;
    _otros NUMERIC;
    _punto_eq NUMERIC;
    _margen_neto NUMERIC;
    _ttm_1_4 NUMERIC; _ttm_2 NUMERIC; _ttm_4 NUMERIC;
    _ttm_10 NUMERIC; _ttm_10_1 NUMERIC; _ttm_10_3 NUMERIC; _ttm_10_4 NUMERIC;
    _ttm_12_7 NUMERIC; _ttm_12_8 NUMERIC;
    _ttm_6 NUMERIC; _ttm_7 NUMERIC; _ttm_8 NUMERIC; _ttm_13 NUMERIC;
BEGIN
    FOR _entidad IN
        SELECT DISTINCT nomb_correg
        FROM marts.mv_eeff_resultados_ancho
        WHERE periodo = _periodo AND moneda = _moneda
    LOOP
        _cartera_prom := marts.cartera_promedio_12m(_periodo, _entidad.nomb_correg, _moneda);
        IF _cartera_prom IS NULL OR _cartera_prom = 0 THEN CONTINUE; END IF;

        _ttm_1_4  := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_1_4',  TRUE);
        _ttm_2    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_2',    TRUE);
        _ttm_4    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_4',    TRUE);
        _ttm_10   := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10',   TRUE);
        _ttm_10_1 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_1', TRUE);
        _ttm_10_3 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_3', TRUE);
        _ttm_10_4 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_4', TRUE);
        _ttm_12_7 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_12_7', TRUE);
        _ttm_12_8 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_12_8', TRUE);
        _ttm_6    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_6',    TRUE);
        _ttm_7    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_7',    TRUE);
        _ttm_8    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_8',    TRUE);
        _ttm_13   := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_13',   TRUE);

        -- cta_1_4 NULL solo si la entidad no tiene cta de ingresos en este periodo.
        IF _ttm_1_4 IS NULL THEN CONTINUE; END IF;

        _rendimiento       :=  _ttm_1_4 / _cartera_prom;
        _costo_fondeo      := -COALESCE(_ttm_2, 0) / _cartera_prom;
        _costo_provisiones := -COALESCE(_ttm_4, 0) / _cartera_prom;
        _gastos_op         := -(COALESCE(_ttm_10, 0) + COALESCE(_ttm_12_7, 0) + COALESCE(_ttm_12_8, 0)) / _cartera_prom;
        _gastos_personal   := -COALESCE(_ttm_10_1, 0) / _cartera_prom;
        _gastos_generales  := -(COALESCE(_ttm_10_3, 0) + COALESCE(_ttm_10_4, 0)) / _cartera_prom;
        _deprec            := -(COALESCE(_ttm_12_7, 0) + COALESCE(_ttm_12_8, 0)) / _cartera_prom;
        _otros             :=  (COALESCE(_ttm_6, 0) - COALESCE(_ttm_7, 0) + COALESCE(_ttm_8, 0) + COALESCE(_ttm_13, 0)) / _cartera_prom;
        _punto_eq          := _costo_fondeo + _costo_provisiones + _gastos_op;
        _margen_neto       := _rendimiento + _punto_eq + _otros;

        INSERT INTO marts.fact_kpis_mensuales (periodo, nomb_correg, moneda, kpi_codigo, valor) VALUES
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_rendimiento_cartera', _rendimiento),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_costo_fondeo',        _costo_fondeo),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_costo_provisiones',   _costo_provisiones),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_gastos_operacionales', _gastos_op),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_gastos_personal',     _gastos_personal),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_gastos_generales',    _gastos_generales),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_deprec_amortiz',      _deprec),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_otros_ing_egr',       _otros),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_punto_equilibrio',    _punto_eq),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_margen_neto',         _margen_neto)
        ON CONFLICT (periodo, nomb_correg, moneda, kpi_codigo) DO UPDATE SET
            valor       = EXCLUDED.valor,
            computed_at = now();

        entidad        := _entidad.nomb_correg;
        kpis_insertados := 10;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION marts.compute_kpis_punto_equilibrio IS
    'Computa 10 KPIs de Punto de Equilibrio. TTM exacto si hay prior-year; YTD×12/mes como fallback.';

-- -----------------------------------------------------------------------
-- 3. Re-computar entidades SF para periodos recientes donde faltan KPIs
--    por haber sido borrados en V211/V212 (Banco Efectiva, InFinance XP,
--    Santander Consumer Bank, Compartamos Banco y otros con nombre nuevo).
--    Loop compacto: ulitmos 48 periodos mensuales desde el actual.
-- -----------------------------------------------------------------------
DO $$
DECLARE
    _p INT;
    _anio_actual INT := EXTRACT(YEAR FROM CURRENT_DATE);
    _mes_actual  INT := EXTRACT(MONTH FROM CURRENT_DATE);
    _periodo_actual INT := _anio_actual * 100 + _mes_actual;
    _desde INT;
BEGIN
    _desde := (_anio_actual - 4) * 100 + 1;
    FOR _p IN
        SELECT DISTINCT r.periodo
        FROM marts.mv_eeff_resultados_ancho r
        WHERE r.tipo_entidad NOT LIKE 'COOPAC_%'
          AND r.moneda = 'TOTAL'
          AND r.periodo BETWEEN _desde AND _periodo_actual
          AND NOT EXISTS (
            SELECT 1 FROM marts.fact_kpis_mensuales f
            WHERE f.nomb_correg = r.nomb_correg
              AND f.moneda = 'TOTAL'
              AND f.periodo = r.periodo
              AND f.kpi_codigo = 'pe_rendimiento_cartera'
          )
        ORDER BY periodo
    LOOP
        PERFORM marts.compute_kpis_punto_equilibrio(_p);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------
-- 4. Re-computar COOPACs con formula annualized (misma logica que V199
--    pero con CASE dic_exists/same_exists → TTM o YTD×12/mes).
--    Cubre todos los periodos donde faltaban prior-year y ahora podemos
--    dar una estimacion en lugar de "—".
-- -----------------------------------------------------------------------
INSERT INTO marts.fact_kpis_mensuales (periodo, nomb_correg, moneda, kpi_codigo, valor)
WITH

coopac_periodos AS (
    SELECT DISTINCT r.periodo, r.nomb_correg, 'TOTAL'::text AS moneda
    FROM marts.mv_eeff_resultados_ancho r
    WHERE r.tipo_entidad LIKE 'COOPAC_%'
      AND r.moneda = 'TOTAL'
),

ytd_cur AS (
    SELECT
        cp.periodo, cp.nomb_correg, cp.moneda,
        COALESCE(r.cta_1_4,  0) AS cta_1_4,
        COALESCE(r.cta_2,    0) AS cta_2,
        COALESCE(r.cta_4,    0) AS cta_4,
        COALESCE(r.cta_10,   0) AS cta_10,
        COALESCE(r.cta_10_1, 0) AS cta_10_1,
        COALESCE(r.cta_10_3, 0) AS cta_10_3,
        COALESCE(r.cta_10_4, 0) AS cta_10_4,
        COALESCE(r.cta_12_7, 0) AS cta_12_7,
        COALESCE(r.cta_12_8, 0) AS cta_12_8,
        COALESCE(r.cta_6,    0) AS cta_6,
        COALESCE(r.cta_7,    0) AS cta_7,
        COALESCE(r.cta_8,    0) AS cta_8,
        COALESCE(r.cta_13,   0) AS cta_13
    FROM coopac_periodos cp
    JOIN marts.mv_eeff_resultados_ancho r
      ON r.periodo = cp.periodo AND r.nomb_correg = cp.nomb_correg AND r.moneda = cp.moneda
),

ytd_dic AS (
    SELECT
        cp.periodo, cp.nomb_correg, cp.moneda,
        r.periodo IS NOT NULL         AS dic_exists,
        COALESCE(r.cta_1_4,  0)      AS cta_1_4,
        COALESCE(r.cta_2,    0)      AS cta_2,
        COALESCE(r.cta_4,    0)      AS cta_4,
        COALESCE(r.cta_10,   0)      AS cta_10,
        COALESCE(r.cta_10_1, 0)      AS cta_10_1,
        COALESCE(r.cta_10_3, 0)      AS cta_10_3,
        COALESCE(r.cta_10_4, 0)      AS cta_10_4,
        COALESCE(r.cta_12_7, 0)      AS cta_12_7,
        COALESCE(r.cta_12_8, 0)      AS cta_12_8,
        COALESCE(r.cta_6,    0)      AS cta_6,
        COALESCE(r.cta_7,    0)      AS cta_7,
        COALESCE(r.cta_8,    0)      AS cta_8,
        COALESCE(r.cta_13,   0)      AS cta_13
    FROM coopac_periodos cp
    LEFT JOIN marts.mv_eeff_resultados_ancho r
      ON r.periodo     = (cp.periodo / 100 - 1) * 100 + 12
     AND r.nomb_correg = cp.nomb_correg
     AND r.moneda      = cp.moneda
),

ytd_same AS (
    SELECT
        cp.periodo, cp.nomb_correg, cp.moneda,
        r.periodo IS NOT NULL         AS same_exists,
        COALESCE(r.cta_1_4,  0)      AS cta_1_4,
        COALESCE(r.cta_2,    0)      AS cta_2,
        COALESCE(r.cta_4,    0)      AS cta_4,
        COALESCE(r.cta_10,   0)      AS cta_10,
        COALESCE(r.cta_10_1, 0)      AS cta_10_1,
        COALESCE(r.cta_10_3, 0)      AS cta_10_3,
        COALESCE(r.cta_10_4, 0)      AS cta_10_4,
        COALESCE(r.cta_12_7, 0)      AS cta_12_7,
        COALESCE(r.cta_12_8, 0)      AS cta_12_8,
        COALESCE(r.cta_6,    0)      AS cta_6,
        COALESCE(r.cta_7,    0)      AS cta_7,
        COALESCE(r.cta_8,    0)      AS cta_8,
        COALESCE(r.cta_13,   0)      AS cta_13
    FROM coopac_periodos cp
    LEFT JOIN marts.mv_eeff_resultados_ancho r
      ON r.periodo     = cp.periodo - 100
     AND r.nomb_correg = cp.nomb_correg
     AND r.moneda      = cp.moneda
),

ttm AS (
    SELECT
        c.periodo, c.nomb_correg, c.moneda,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_1_4  + d.cta_1_4  - s.cta_1_4
             ELSE c.cta_1_4  * 12 / (c.periodo % 100) END AS ttm_1_4,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_2    + d.cta_2    - s.cta_2
             ELSE c.cta_2    * 12 / (c.periodo % 100) END AS ttm_2,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_4    + d.cta_4    - s.cta_4
             ELSE c.cta_4    * 12 / (c.periodo % 100) END AS ttm_4,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_10   + d.cta_10   - s.cta_10
             ELSE c.cta_10   * 12 / (c.periodo % 100) END AS ttm_10,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_10_1 + d.cta_10_1 - s.cta_10_1
             ELSE c.cta_10_1 * 12 / (c.periodo % 100) END AS ttm_10_1,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_10_3 + d.cta_10_3 - s.cta_10_3
             ELSE c.cta_10_3 * 12 / (c.periodo % 100) END AS ttm_10_3,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_10_4 + d.cta_10_4 - s.cta_10_4
             ELSE c.cta_10_4 * 12 / (c.periodo % 100) END AS ttm_10_4,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_12_7 + d.cta_12_7 - s.cta_12_7
             ELSE c.cta_12_7 * 12 / (c.periodo % 100) END AS ttm_12_7,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_12_8 + d.cta_12_8 - s.cta_12_8
             ELSE c.cta_12_8 * 12 / (c.periodo % 100) END AS ttm_12_8,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_6    + d.cta_6    - s.cta_6
             ELSE c.cta_6    * 12 / (c.periodo % 100) END AS ttm_6,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_7    + d.cta_7    - s.cta_7
             ELSE c.cta_7    * 12 / (c.periodo % 100) END AS ttm_7,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_8    + d.cta_8    - s.cta_8
             ELSE c.cta_8    * 12 / (c.periodo % 100) END AS ttm_8,
        CASE WHEN d.dic_exists AND s.same_exists
             THEN c.cta_13   + d.cta_13   - s.cta_13
             ELSE c.cta_13   * 12 / (c.periodo % 100) END AS ttm_13
    FROM ytd_cur c
    JOIN ytd_dic  d ON d.periodo = c.periodo AND d.nomb_correg = c.nomb_correg AND d.moneda = c.moneda
    JOIN ytd_same s ON s.periodo = c.periodo AND s.nomb_correg = c.nomb_correg AND s.moneda = c.moneda
),

cartera AS (
    SELECT
        cp.periodo, cp.nomb_correg, cp.moneda,
        AVG(
            COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0) +
            COALESCE(b.cta_a4_3, 0) + GREATEST(COALESCE(b.cta_a4_4, 0), 0)
        ) AS cartera_prom
    FROM coopac_periodos cp
    JOIN marts.v_eeff_balance_ancho b
      ON b.nomb_correg = cp.nomb_correg AND b.moneda = cp.moneda
     AND b.periodo <= cp.periodo
     AND b.periodo >= CASE
                        WHEN cp.periodo % 100 = 12 THEN cp.periodo - 11
                        ELSE (cp.periodo / 100 - 1) * 100 + (cp.periodo % 100 + 1)
                      END
    WHERE (COALESCE(b.cta_a4_1,0)+COALESCE(b.cta_a4_2,0)+
           COALESCE(b.cta_a4_3,0)+GREATEST(COALESCE(b.cta_a4_4,0),0)) > 0
    GROUP BY cp.periodo, cp.nomb_correg, cp.moneda
    HAVING AVG(COALESCE(b.cta_a4_1,0)+COALESCE(b.cta_a4_2,0)+
               COALESCE(b.cta_a4_3,0)+GREATEST(COALESCE(b.cta_a4_4,0),0)) > 0
),

kpis AS (
    SELECT
        t.periodo, t.nomb_correg, t.moneda,
        t.ttm_1_4                                             / c.cartera_prom AS rendimiento,
        -t.ttm_2                                              / c.cartera_prom AS costo_fondeo,
        -t.ttm_4                                              / c.cartera_prom AS provisiones,
        -(t.ttm_10 + t.ttm_12_7 + t.ttm_12_8)               / c.cartera_prom AS gastos_op,
        -t.ttm_10_1                                           / c.cartera_prom AS gastos_personal,
        -(t.ttm_10_3 + t.ttm_10_4)                           / c.cartera_prom AS gastos_generales,
        -(t.ttm_12_7 + t.ttm_12_8)                           / c.cartera_prom AS deprec,
        (t.ttm_6 - t.ttm_7 + t.ttm_8 + t.ttm_13)            / c.cartera_prom AS otros
    FROM ttm t
    JOIN cartera c ON c.periodo = t.periodo AND c.nomb_correg = t.nomb_correg AND c.moneda = t.moneda
    WHERE t.ttm_1_4 > 0  -- Excluir entidades sin ingresos registrados
)

SELECT k.periodo, k.nomb_correg, k.moneda, v.kpi_codigo, v.valor
FROM kpis k
CROSS JOIN LATERAL (VALUES
    ('pe_rendimiento_cartera',  k.rendimiento),
    ('pe_costo_fondeo',         k.costo_fondeo),
    ('pe_costo_provisiones',    k.provisiones),
    ('pe_gastos_operacionales', k.gastos_op),
    ('pe_gastos_personal',      k.gastos_personal),
    ('pe_gastos_generales',     k.gastos_generales),
    ('pe_deprec_amortiz',       k.deprec),
    ('pe_otros_ing_egr',        k.otros),
    ('pe_punto_equilibrio',     k.costo_fondeo + k.provisiones + k.gastos_op),
    ('pe_margen_neto',          k.rendimiento + k.costo_fondeo + k.provisiones + k.gastos_op + k.otros)
) AS v(kpi_codigo, valor)
ON CONFLICT (periodo, nomb_correg, moneda, kpi_codigo) DO UPDATE SET
    valor       = EXCLUDED.valor,
    computed_at = now();
