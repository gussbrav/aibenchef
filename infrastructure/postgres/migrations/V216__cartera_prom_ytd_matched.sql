-- =========================================================================
-- V216: cartera_prom alineada al periodo del numerador (YTD-matched)
--
-- PROBLEMA CONCEPTUAL (post-V215)
--   V214 introdujo el fallback YTD×12/M en el numerador. V215 trackea la
--   metodología. PERO el denominador seguía siendo "cartera 12m rolling"
--   incluso para casos anualizados, lo cual es dimensionalmente inconsistente:
--
--     Numerador (anualizado) = YTD(ene–jun 2026) × 2  → "annual run-rate"
--     Denominador (12m)      = AVG(cartera jul 2025 – jun 2026)
--     Ratio                  = run-rate anual / promedio mezclado de 2 años
--
--   El denominador mezcla cartera de un periodo que el numerador NO cubre
--   (jul–dic 2025), distorsionando el ratio cuando la cartera creció/cayó
--   fuerte antes del arranque del YTD.
--
-- SOLUCIÓN PROFESIONAL
--   Alinear la ventana de cartera_prom al periodo del numerador:
--
--     - Si metodo = 'ttm_exacto'      → cartera AVG en 12m rolling (actual).
--     - Si metodo = 'ytd_anualizado'  → cartera AVG en ENE–M del año actual,
--                                       con fallback a 12m rolling si YTD
--                                       tiene < 2 observaciones.
--
--   La ratio final es matemáticamente equivalente a:
--     (YTD/cartera_ytd) × 12/M
--   es decir, "la tasa observada en el YTD, expresada en base anual".
--
-- IMPACTO ESPERADO
--   TTM exacto (87% del dataset) → sin cambio.
--   YTD anualizado con suficientes obs YTD (~5-8%) → ajuste real.
--   YTD anualizado sin obs YTD (fallback a 12m) → sin cambio vs V215.
-- =========================================================================

-- -----------------------------------------------------------------------
-- 1. Nueva columna en metadata: ventana_cartera
-- -----------------------------------------------------------------------
ALTER TABLE marts.fact_pe_metadata
    ADD COLUMN IF NOT EXISTS ventana_cartera TEXT
    CHECK (ventana_cartera IN ('rolling_12m', 'ytd'));

COMMENT ON COLUMN marts.fact_pe_metadata.ventana_cartera IS
    'Ventana usada para cartera_prom: rolling_12m (12 meses moviles) o ytd (ene–M del año actual).';

-- -----------------------------------------------------------------------
-- 2. Helper: cartera_prom en ventana YTD
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.cartera_promedio_ytd_con_meta(
    _periodo INT, _nomb_correg TEXT, _moneda TEXT
) RETURNS TABLE(cartera_prom NUMERIC, cartera_obs INT) AS $$
DECLARE
    _anio INT := _periodo / 100;
BEGIN
    RETURN QUERY
    SELECT AVG(v)::NUMERIC AS cartera_prom,
           COUNT(*)::INT   AS cartera_obs
    FROM (
        SELECT (COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0)
              + COALESCE(cta_a4_3, 0)) AS v
        FROM marts.v_eeff_balance_ancho
        WHERE nomb_correg = _nomb_correg
          AND moneda      = _moneda
          AND periodo    BETWEEN (_anio * 100 + 1) AND _periodo
    ) t
    WHERE v > 0;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.cartera_promedio_ytd_con_meta IS
    'Promedio de cartera bruta en la ventana YTD (ene del año actual hasta el periodo). Usado para casos anualizados.';

-- -----------------------------------------------------------------------
-- 3. compute_kpis_PE actualizada: cartera YTD-matched para casos anualizados
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.compute_kpis_punto_equilibrio(_periodo INT)
RETURNS TABLE (entidad TEXT, kpis_insertados INT) AS $$
DECLARE
    _entidad     RECORD;
    _moneda      TEXT := 'TOTAL';
    _anio        INT  := _periodo / 100;
    _mes         INT  := _periodo % 100;
    _cartera_prom NUMERIC;
    _cartera_obs  INT;
    _ventana_cartera TEXT;
    _cartera_ytd_prom NUMERIC;
    _cartera_ytd_obs  INT;
    _dic_exists  BOOL;
    _same_exists BOOL;
    _metodo      TEXT;
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
        _dic_exists := EXISTS (
            SELECT 1 FROM marts.mv_eeff_resultados_ancho
            WHERE periodo = (_anio - 1) * 100 + 12
              AND nomb_correg = _entidad.nomb_correg AND moneda = _moneda
        );
        _same_exists := EXISTS (
            SELECT 1 FROM marts.mv_eeff_resultados_ancho
            WHERE periodo = (_anio - 1) * 100 + _mes
              AND nomb_correg = _entidad.nomb_correg AND moneda = _moneda
        );

        _metodo := CASE WHEN _dic_exists AND _same_exists
                        THEN 'ttm_exacto'
                        ELSE 'ytd_anualizado'
                   END;

        -- Selección de ventana de cartera según metodología:
        --   - TTM exacto: 12m rolling (dimensionalmente correcto para TTM).
        --   - YTD anualizado: preferir YTD si tiene >= 2 obs (mejor alineación
        --     con el numerador anualizado); fallback a 12m si YTD insuficiente.
        IF _metodo = 'ytd_anualizado' AND _mes < 12 THEN
            SELECT c.cartera_prom, c.cartera_obs
              INTO _cartera_ytd_prom, _cartera_ytd_obs
            FROM marts.cartera_promedio_ytd_con_meta(_periodo, _entidad.nomb_correg, _moneda) c;

            IF _cartera_ytd_obs >= 2 AND _cartera_ytd_prom IS NOT NULL AND _cartera_ytd_prom > 0 THEN
                _cartera_prom    := _cartera_ytd_prom;
                _cartera_obs     := _cartera_ytd_obs;
                _ventana_cartera := 'ytd';
            ELSE
                SELECT c.cartera_prom, c.cartera_obs
                  INTO _cartera_prom, _cartera_obs
                FROM marts.cartera_promedio_12m_con_meta(_periodo, _entidad.nomb_correg, _moneda) c;
                _ventana_cartera := 'rolling_12m';
            END IF;
        ELSE
            -- TTM exacto o diciembre (YTD = TTM) → 12m rolling.
            SELECT c.cartera_prom, c.cartera_obs
              INTO _cartera_prom, _cartera_obs
            FROM marts.cartera_promedio_12m_con_meta(_periodo, _entidad.nomb_correg, _moneda) c;
            _ventana_cartera := 'rolling_12m';
        END IF;

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

        IF _ttm_1_4 IS NULL THEN CONTINUE; END IF;

        _rendimiento       :=  _ttm_1_4 / _cartera_prom;

        IF _rendimiento < 0 OR _rendimiento > 3 THEN CONTINUE; END IF;

        _costo_fondeo      := -COALESCE(_ttm_2, 0) / _cartera_prom;
        _costo_provisiones := -COALESCE(_ttm_4, 0) / _cartera_prom;
        _gastos_op         := -(COALESCE(_ttm_10, 0) + COALESCE(_ttm_12_7, 0) + COALESCE(_ttm_12_8, 0)) / _cartera_prom;
        _gastos_personal   := -COALESCE(_ttm_10_1, 0) / _cartera_prom;
        _gastos_generales  := -(COALESCE(_ttm_10_3, 0) + COALESCE(_ttm_10_4, 0)) / _cartera_prom;
        _deprec            := -(COALESCE(_ttm_12_7, 0) + COALESCE(_ttm_12_8, 0)) / _cartera_prom;
        _otros             :=  (COALESCE(_ttm_6, 0) - COALESCE(_ttm_7, 0) + COALESCE(_ttm_8, 0) + COALESCE(_ttm_13, 0)) / _cartera_prom;
        _punto_eq          := _costo_fondeo + _costo_provisiones + _gastos_op;
        _margen_neto       := _rendimiento + _punto_eq + _otros;

        INSERT INTO marts.fact_pe_metadata (periodo, nomb_correg, moneda, metodo_calculo, cartera_obs, ventana_cartera)
        VALUES (_periodo, _entidad.nomb_correg, _moneda, _metodo, _cartera_obs, _ventana_cartera)
        ON CONFLICT (periodo, nomb_correg, moneda) DO UPDATE SET
            metodo_calculo   = EXCLUDED.metodo_calculo,
            cartera_obs      = EXCLUDED.cartera_obs,
            ventana_cartera  = EXCLUDED.ventana_cartera,
            computed_at      = now();

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
    'V216: computa 10 KPIs PE. Denominador YTD-matched para casos anualizados (si YTD tiene >=2 obs), 12m rolling para TTM exacto.';

-- -----------------------------------------------------------------------
-- 4. Recompute: se corren TODOS los periodos para que las metricas
--    reflejen la nueva metodología. ~5 años × ~400 entidades = ~24k
--    entity-periods. Debería tardar ~5-10 minutos.
-- -----------------------------------------------------------------------
DO $$
DECLARE
    _p INT;
BEGIN
    FOR _p IN
        SELECT DISTINCT periodo
        FROM marts.mv_eeff_resultados_ancho
        WHERE moneda = 'TOTAL'
          AND periodo >= 202101
        ORDER BY periodo
    LOOP
        PERFORM marts.compute_kpis_punto_equilibrio(_p);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------
-- 5. Backfill ventana_cartera para filas de metadata existentes que
--    quedaron NULL (si el recompute de arriba no las tocó).
--    En la práctica V215 ya habría poblado metodo + obs, y el recompute
--    actualiza todo. Este UPDATE es sólo un safety net defensivo.
-- -----------------------------------------------------------------------
UPDATE marts.fact_pe_metadata
SET ventana_cartera = 'rolling_12m'
WHERE ventana_cartera IS NULL;

-- -----------------------------------------------------------------------
-- 6. Ahora que todas las filas tienen ventana_cartera, hacemos NOT NULL.
-- -----------------------------------------------------------------------
ALTER TABLE marts.fact_pe_metadata
    ALTER COLUMN ventana_cartera SET NOT NULL;
