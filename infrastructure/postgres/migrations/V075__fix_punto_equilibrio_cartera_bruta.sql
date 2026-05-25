-- =========================================================================
-- V075: Fix Punto de Equilibrio para alinear con Excel oficial del directorio
--
-- Bug 1: cartera_promedio_12m usaba cta_a4 (cartera NETA, despues de
--        provisiones). El Excel oficial usa cartera BRUTA. Esto inflaba
--        todos los ratios ~9% (cartera neta es ~9% menor que bruta por
--        las provisiones constituidas).
--
-- Bug 2: pe_punto_equilibrio NO incluia "otros ingresos/egresos" en el calculo.
--        El Excel oficial define:
--          PE = Costos - Otros (es decir, costos NETOS de otros ingresos)
--          MargenNeto = Rendimiento - PE
--        Esto presenta el PE como el "rendimiento minimo necesario para no
--        perder dinero" — mas util que costos brutos.
--
-- Despues de aplicar esta migracion hay que recomputar:
--   DELETE FROM marts.fact_kpis_mensuales WHERE kpi_codigo LIKE 'pe_%';
--   SELECT marts.compute_kpis_punto_equilibrio(p) FROM (
--     SELECT DISTINCT periodo p FROM marts.mv_eeff_resultados_ancho
--   ) ps;
-- =========================================================================

-- ----------------------------------------------------------------------
-- FIX 1: cartera_promedio_12m usa cartera BRUTA (A4.1 + A4.2 + A4.3)
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.cartera_promedio_12m(
    _periodo INT,
    _nomb_correg TEXT,
    _moneda TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _suma NUMERIC := 0;
    _n INT := 0;
    _row RECORD;
    _anio INT := _periodo / 100;
    _mes INT := _periodo % 100;
BEGIN
    FOR _row IN
        SELECT (COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0))
                AS valor
        FROM marts.v_eeff_balance_ancho
        WHERE nomb_correg = _nomb_correg
          AND moneda = _moneda
          AND periodo <= _periodo
          AND periodo >= ((_anio - 1) * 100 + _mes)
        ORDER BY periodo
    LOOP
        IF _row.valor IS NOT NULL AND _row.valor > 0 THEN
            _suma := _suma + _row.valor;
            _n := _n + 1;
        END IF;
    END LOOP;

    IF _n = 0 THEN
        RETURN NULL;
    END IF;
    RETURN _suma / _n;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.cartera_promedio_12m IS
    'Cartera BRUTA promedio 12m (A4.1 Vigentes + A4.2 Refinanciados + A4.3 Atrasados). '
    'Alinea con el Excel oficial del directorio. Antes usaba cta_a4 (neta) que '
    'inflaba todos los ratios ~9% por las provisiones constituidas.';


-- ----------------------------------------------------------------------
-- FIX 2: PE neto de Otros + MargenNeto = Rend - PE
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.compute_kpis_punto_equilibrio(_periodo INT)
RETURNS TABLE (entidad TEXT, kpis_insertados INT) AS $$
DECLARE
    _entidad RECORD;
    _moneda TEXT := 'TOTAL';
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
    _ttm_1_4 NUMERIC;
    _ttm_2 NUMERIC;
    _ttm_4 NUMERIC;
    _ttm_10 NUMERIC;
    _ttm_10_1 NUMERIC;
    _ttm_10_3 NUMERIC;
    _ttm_10_4 NUMERIC;
    _ttm_12_7 NUMERIC;
    _ttm_12_8 NUMERIC;
    _ttm_6 NUMERIC;
    _ttm_7 NUMERIC;
    _ttm_8 NUMERIC;
    _ttm_13 NUMERIC;
BEGIN
    FOR _entidad IN
        SELECT DISTINCT nomb_correg
        FROM marts.mv_eeff_resultados_ancho
        WHERE periodo = _periodo AND moneda = _moneda
    LOOP
        _cartera_prom := marts.cartera_promedio_12m(_periodo, _entidad.nomb_correg, _moneda);

        IF _cartera_prom IS NULL OR _cartera_prom = 0 THEN
            CONTINUE;
        END IF;

        _ttm_1_4  := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_1_4');
        _ttm_2    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_2');
        _ttm_4    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_4');
        _ttm_10   := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10');
        _ttm_10_1 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_1');
        _ttm_10_3 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_3');
        _ttm_10_4 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_4');
        _ttm_12_7 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_12_7');
        _ttm_12_8 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_12_8');
        _ttm_6    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_6');
        _ttm_7    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_7');
        _ttm_8    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_8');
        _ttm_13   := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_13');

        _rendimiento       :=  COALESCE(_ttm_1_4, 0) / _cartera_prom;
        _costo_fondeo      := -COALESCE(_ttm_2, 0) / _cartera_prom;
        _costo_provisiones := -COALESCE(_ttm_4, 0) / _cartera_prom;
        _gastos_op         := -(COALESCE(_ttm_10, 0) + COALESCE(_ttm_12_7, 0) + COALESCE(_ttm_12_8, 0)) / _cartera_prom;
        _gastos_personal   := -COALESCE(_ttm_10_1, 0) / _cartera_prom;
        _gastos_generales  := -(COALESCE(_ttm_10_3, 0) + COALESCE(_ttm_10_4, 0)) / _cartera_prom;
        _deprec            := -(COALESCE(_ttm_12_7, 0) + COALESCE(_ttm_12_8, 0)) / _cartera_prom;
        _otros             :=  (COALESCE(_ttm_6, 0) - COALESCE(_ttm_7, 0) + COALESCE(_ttm_8, 0) + COALESCE(_ttm_13, 0)) / _cartera_prom;

        -- FIX: PE NETO de Otros (alineado con Excel oficial del directorio)
        -- Antes: _punto_eq = costos brutos
        -- Ahora: _punto_eq = costos + otros (siendo otros generalmente positivo,
        --        reduce el PE; siendo negativo, lo aumenta)
        _punto_eq    := _costo_fondeo + _costo_provisiones + _gastos_op + _otros;

        -- FIX: MargenNeto = Rendimiento + PE (sin sumar Otros aparte,
        -- porque ya esta dentro de PE)
        _margen_neto := _rendimiento + _punto_eq;

        INSERT INTO marts.fact_kpis_mensuales (periodo, nomb_correg, moneda, kpi_codigo, valor) VALUES
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_rendimiento_cartera', _rendimiento),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_costo_fondeo', _costo_fondeo),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_costo_provisiones', _costo_provisiones),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_gastos_operacionales', _gastos_op),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_gastos_personal', _gastos_personal),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_gastos_generales', _gastos_generales),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_deprec_amortiz', _deprec),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_otros_ing_egr', _otros),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_punto_equilibrio', _punto_eq),
            (_periodo, _entidad.nomb_correg, _moneda, 'pe_margen_neto', _margen_neto)
        ON CONFLICT (periodo, nomb_correg, moneda, kpi_codigo) DO UPDATE SET
            valor = EXCLUDED.valor,
            computed_at = now();

        entidad := _entidad.nomb_correg;
        kpis_insertados := 10;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION marts.compute_kpis_punto_equilibrio IS
    'Computa los 10 KPIs de Punto de Equilibrio. PE incluye Otros Ingresos '
    '(neto) para alinear con Excel oficial: PE = costos - otros, MN = Rend - PE.';


-- ----------------------------------------------------------------------
-- Recomputar TODOS los periodos con la nueva formula.
-- Idempotente: ON CONFLICT actualiza.
-- ----------------------------------------------------------------------
DO $$
DECLARE
    _periodo INT;
BEGIN
    FOR _periodo IN
        SELECT DISTINCT periodo
        FROM marts.mv_eeff_resultados_ancho
        ORDER BY periodo
    LOOP
        PERFORM marts.compute_kpis_punto_equilibrio(_periodo);
    END LOOP;
END $$;
