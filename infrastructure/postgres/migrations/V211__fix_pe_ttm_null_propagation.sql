-- =========================================================================
-- V211: Fix COALESCE bug en compute_kpis_punto_equilibrio
--
-- Problema: las lineas 163-172 de V034 usaban COALESCE(_ttm_X, 0) para
-- los ingresos principales (cta_1_4). Cuando ttm_resultados() devuelve
-- NULL por datos incompletos (ej: entidad nueva sin prior-year en MV,
-- o entidad que no reporto diciembre del año anterior), COALESCE convierte
-- a 0 y almacena pe_rendimiento_cartera = 0.00 — matemáticamente absurdo
-- para cualquier institucion financiera activa.
--
-- Entidades afectadas: Banco Efectiva, InFinance XP, Santander Consumer
-- Bank, Compartamos Banco (cambios de nombre → sin datos año anterior
-- bajo el nombre nuevo) + COOPACs con gaps de diciembre.
--
-- Fix: si _ttm_1_4 IS NULL (ingresos de cartera no calculables),
-- CONTINUE — mejor mostrar "—" en la UI que un 0% inventado.
-- Los COASCOs de cuentas de costo siguen siendo validos (si no hay
-- costo de fondeo, es 0; si no hay provisiones, es 0).
-- =========================================================================

-- 1. Corregir la funcion
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
    _count INT;
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

        -- Si los ingresos de cartera no son calculables (falta año anterior),
        -- omitir esta entidad/periodo en lugar de almacenar 0% distorsionado.
        IF _ttm_1_4 IS NULL THEN
            CONTINUE;
        END IF;

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

COMMENT ON FUNCTION marts.compute_kpis_punto_equilibrio IS 'Computa y UPSERT los 10 KPIs de Punto de Equilibrio. Omite entidades sin TTM calculable (prior-year ausente).';

-- 2. Limpiar los 1419 registros distorsionados (rendimiento=0 imposible)
--    Se eliminan todos los pe_* KPIs del mismo (periodo, nomb_correg, moneda)
--    para mantener coherencia interna — si rendimiento es invalido, todos lo son.
DELETE FROM marts.fact_kpis_mensuales
WHERE kpi_codigo LIKE 'pe_%'
  AND (periodo, nomb_correg, moneda) IN (
    SELECT periodo, nomb_correg, moneda
    FROM marts.fact_kpis_mensuales
    WHERE kpi_codigo = 'pe_rendimiento_cartera'
      AND valor = 0
  );
