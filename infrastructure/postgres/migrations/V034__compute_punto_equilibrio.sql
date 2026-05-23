-- =========================================================================
-- V034: Function que computa los 10 KPIs de "Punto de Equilibrio"
-- y persiste en marts.fact_kpis_mensuales.
--
-- Estos son los KPIs centrales del benchmark Caja Arequipa (slide 6).
-- La logica replica la hoja "Variables_<Entidad>" del Excel original
-- (filas 95-122: "RESULTADO ACUMULADO 12 MESES" + ratios).
--
-- NOTA sobre anualizacion:
-- Los reportes SBS de Estado de Resultados son YTD (Year-To-Date acumulados
-- desde enero). Para obtener "trailing 12 months" se usa:
--
--     ttm(M) = ytd(M) + ytd(Dic_prev) - ytd(M_prev_year)
--
-- Esto da los flujos de los ultimos 12 meses calendario.
-- Para enero (M=YYYYM=YYYY01) se simplifica a ytd(Dic_prev) directamente.
-- =========================================================================

-- ----------------------------------------------------------------------
-- Helper: trailing 12 months para una cuenta del Estado de Resultados
-- en un periodo dado.
--
-- Asume que marts.mv_eeff_resultados_ancho tiene valores YTD.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.ttm_resultados(
    _periodo INT,
    _nomb_correg TEXT,
    _moneda TEXT,
    _columna TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _anio INT := _periodo / 100;
    _mes  INT := _periodo % 100;
    _ytd_actual NUMERIC;
    _ytd_dic_prev NUMERIC;
    _ytd_mismo_mes_prev NUMERIC;
    _query TEXT;
BEGIN
    _query := format(
        'SELECT %I FROM marts.mv_eeff_resultados_ancho WHERE periodo=$1 AND nomb_correg=$2 AND moneda=$3',
        _columna
    );

    EXECUTE _query INTO _ytd_actual USING _periodo, _nomb_correg, _moneda;
    EXECUTE _query INTO _ytd_dic_prev USING ((_anio - 1) * 100 + 12), _nomb_correg, _moneda;
    EXECUTE _query INTO _ytd_mismo_mes_prev USING ((_anio - 1) * 100 + _mes), _nomb_correg, _moneda;

    -- Si falta alguno, devolvemos NULL en lugar de inventar.
    IF _ytd_actual IS NULL OR _ytd_dic_prev IS NULL OR _ytd_mismo_mes_prev IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN _ytd_actual + _ytd_dic_prev - _ytd_mismo_mes_prev;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.ttm_resultados IS 'Trailing 12 months para una cuenta de marts.mv_eeff_resultados_ancho asumiendo valores YTD.';

-- ----------------------------------------------------------------------
-- Helper: cartera promedio 12 meses
-- Usa la cuenta de balance A4 (Creditos Netos) como proxy de cartera bruta.
-- TODO: refinar con cartera bruta real (de reportes de Colocaciones).
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
    _periodo_inicio INT;
    _anio INT := _periodo / 100;
    _mes INT := _periodo % 100;
BEGIN
    -- 12 periodos calendario hacia atras
    FOR _row IN
        SELECT cta_a4 AS valor
        FROM marts.v_eeff_balance_ancho
        WHERE nomb_correg = _nomb_correg
          AND moneda = _moneda
          AND periodo <= _periodo
          AND periodo >= ((_anio - 1) * 100 + _mes)
        ORDER BY periodo
    LOOP
        IF _row.valor IS NOT NULL THEN
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

COMMENT ON FUNCTION marts.cartera_promedio_12m IS 'Promedio simple de cartera (cta_a4) en los ultimos 12 meses. TODO: usar cartera bruta de Colocaciones.';

-- ----------------------------------------------------------------------
-- compute_kpis_punto_equilibrio(periodo): puebla fact_kpis_mensuales
-- con los 10 KPIs del Punto de Equilibrio para TODAS las entidades del
-- periodo. Idempotente (UPSERT).
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

        _rendimiento       :=  COALESCE(_ttm_1_4, 0) / _cartera_prom;
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

COMMENT ON FUNCTION marts.compute_kpis_punto_equilibrio IS 'Computa y UPSERT los 10 KPIs de Punto de Equilibrio para todas las entidades de un periodo dado.';

-- ----------------------------------------------------------------------
-- Vista ancha para consumo directo desde Next.js
-- ----------------------------------------------------------------------
CREATE OR REPLACE VIEW marts.v_punto_equilibrio_ancho AS
SELECT
    periodo,
    nomb_correg,
    moneda,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_rendimiento_cartera') AS pct_rendimiento,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_costo_fondeo')        AS pct_costo_fondeo,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_costo_provisiones')   AS pct_provisiones,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_gastos_operacionales') AS pct_gastos_op,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_gastos_personal')     AS pct_gastos_personal,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_gastos_generales')    AS pct_gastos_generales,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_deprec_amortiz')      AS pct_deprec,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_otros_ing_egr')       AS pct_otros,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_punto_equilibrio')    AS pct_punto_eq,
    MAX(valor) FILTER (WHERE kpi_codigo = 'pe_margen_neto')         AS pct_margen_neto
FROM marts.fact_kpis_mensuales
WHERE kpi_codigo LIKE 'pe_%'
GROUP BY periodo, nomb_correg, moneda;

COMMENT ON VIEW marts.v_punto_equilibrio_ancho IS 'Vista wide-format de los 10 KPIs de Punto de Equilibrio para consumo desde Next.js.';
