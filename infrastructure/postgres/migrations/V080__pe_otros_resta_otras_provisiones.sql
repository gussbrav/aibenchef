-- =========================================================================
-- V080: PE - "Otros" debe restar otras provisiones operativas
-- (cta_12 - cta_12_7 - cta_12_8), no solo sumar ingresos no-cartera.
--
-- Validacion contra Excel oficial Abr 2020 (despues de V076):
--   Compartamos %Otros: 0.8086% (mi DB) vs Excel 0.7898% -> diff +0.0188pp
--   Compartamos %MN:    5.4005% (mi DB) vs Excel 5.3817% -> mismo diff
--
-- Diagnostico: la formula de la celda R116 "Otros Ingresos (Egresos)"
-- del Excel es:
--   = (ER_1 - ER_1_4)             ingresos no-cartera
--   + (ER_6 - ER_7)                servicios financieros netos
--   + ER_8                          venta cartera / op fin
--   - (ER_12 - ER_12_7 - ER_12_8)   OTRAS PROVISIONES OPERATIVAS no-amortizacion
--   + ER_13                         otros ingresos
--
-- Mi formula previa NO restaba (ER_12 - ER_12_7 - ER_12_8). Esas son
-- provisiones operativas distintas a depreciacion / amortizacion (ej:
-- provisiones de cuentas por cobrar, riesgo pais, bienes realizables,
-- contingencias, etc). El Excel las trata como egreso en "Otros".
--
-- Despues de V080: %Otros y %MN deberian coincidir al 2do decimal con Excel.
-- =========================================================================

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
    _ttm_1 NUMERIC;
    _ttm_1_4 NUMERIC;
    _ttm_2 NUMERIC;
    _ttm_4 NUMERIC;
    _ttm_10 NUMERIC;
    _ttm_10_1 NUMERIC;
    _ttm_10_3 NUMERIC;
    _ttm_10_4 NUMERIC;
    _ttm_12 NUMERIC;
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

        _ttm_1    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_1');
        _ttm_1_4  := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_1_4');
        _ttm_2    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_2');
        _ttm_4    := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_4');
        _ttm_10   := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10');
        _ttm_10_1 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_1');
        _ttm_10_3 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_3');
        _ttm_10_4 := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_10_4');
        _ttm_12   := marts.ttm_resultados(_periodo, _entidad.nomb_correg, _moneda, 'cta_12');
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

        -- FIX V080: Otros incluye -(cta_12 - cta_12_7 - cta_12_8) (otras provisiones
        -- operativas no-deprec/amortiz como egreso).
        _otros := (
              (COALESCE(_ttm_1, 0) - COALESCE(_ttm_1_4, 0))
            +  COALESCE(_ttm_6, 0)
            -  COALESCE(_ttm_7, 0)
            +  COALESCE(_ttm_8, 0)
            - (COALESCE(_ttm_12, 0) - COALESCE(_ttm_12_7, 0) - COALESCE(_ttm_12_8, 0))
            +  COALESCE(_ttm_13, 0)
        ) / _cartera_prom;

        _punto_eq    := _costo_fondeo + _costo_provisiones + _gastos_op + _otros;
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
    'Computa los 10 KPIs de Punto de Equilibrio. Match exacto con Excel oficial: '
    'denominador = cartera bruta promedio 12m; '
    'Otros = (cta_1 - cta_1_4) + (cta_6 - cta_7) + cta_8 - (cta_12 - cta_12_7 - cta_12_8) + cta_13. '
    'PE = Costo Fondeo + Costo Provisiones + Gastos Op + Otros; MN = Rend + PE.';

-- Recomputar todos los periodos con la nueva formula
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
