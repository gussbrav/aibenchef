-- =========================================================================
-- V078: marts.cartera_promedio_12m ahora usa Cartera BRUTA (A4.1+A4.2+A4.3)
-- en lugar de cta_a4 (Creditos NETOS de Provisiones).
--
-- El Punto de Equilibrio del Excel usa cartera BRUTA promedio 12m como
-- denominador de todos los ratios. V034 originalmente usaba cta_a4
-- (netos), que es ~6-7% menor que la bruta, dando ratios PE ~1-7% mas
-- altos que el Excel.
--
-- Despues de aplicar este fix, recomputar todos los periodos:
--   SELECT marts.compute_kpis_punto_equilibrio(periodo)
--   FROM (SELECT DISTINCT periodo FROM marts.mv_eeff_resultados_ancho) t;
-- =========================================================================

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
    _periodo_inicio INT;
BEGIN
    -- 12 periodos calendario hacia atras
    _periodo_inicio := CASE WHEN _mes = 12 THEN _periodo - 11
                            ELSE (_anio - 1) * 100 + (_mes + 1) END;

    FOR _row IN
        SELECT (COALESCE(cta_a4_1,0) + COALESCE(cta_a4_2,0) + COALESCE(cta_a4_3,0)) AS valor
        FROM marts.v_eeff_balance_ancho
        WHERE nomb_correg = _nomb_correg
          AND moneda = _moneda
          AND periodo BETWEEN _periodo_inicio AND _periodo
        ORDER BY periodo
    LOOP
        IF _row.valor IS NOT NULL AND _row.valor > 0 THEN
            _suma := _suma + _row.valor;
            _n := _n + 1;
        END IF;
    END LOOP;

    IF _n = 0 THEN RETURN NULL; END IF;
    RETURN _suma / _n;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.cartera_promedio_12m IS
    'Promedio simple de Cartera BRUTA (A4.1+A4.2+A4.3) en los ultimos 12 meses. '
    'V078: cambiado de cta_a4 (netos) a bruta para coincidir con formula Excel PE.';


-- Recomputar PE para todos los periodos (usa la nueva cartera_promedio_12m)
DO $$
DECLARE
    _p INT;
BEGIN
    FOR _p IN SELECT DISTINCT periodo FROM marts.mv_eeff_resultados_ancho
              WHERE moneda='TOTAL' ORDER BY 1
    LOOP
        PERFORM marts.compute_kpis_punto_equilibrio(_p);
    END LOOP;
END $$;
