-- =========================================================================
-- V067: Vista marts.v_kpis_anuales_entidad con componentes TTM (trailing
-- 12 months) y promedios 12m para Eficiencia + Rentabilidad.
--
-- Fórmulas verificadas en Excel "Plantilla PTO EQUILIBRIO.xlsx" hoja
-- "Variables Mibanco":
--
--   Utilidad TTM (r545) = SUM(últimos 12 utilidad_mes)
--     utilidad_mes (r538) = cta_17_ytd - cta_17_ytd_prev (enero = cta_17_ytd)
--
--   Patrimonio_prom_12m (r526) = AVG(cta_c en últimos 12 meses)
--   Activos_prom_12m    (r514) = AVG(cta_a en últimos 12 meses)
--   Cartera_prom_12m    (r288) = AVG(cartera_bruta en últimos 12 meses)
--
--   ROE  (r552) = Utilidad_TTM / Patrimonio_prom_12m
--   ROA  (r558) = Utilidad_TTM / Activos_prom_12m
--
--   Gastos Op / Margen Bruto (r115) =
--     (cta_10_1 + cta_10_2 + cta_10_3 + cta_10_4 + cta_12_7 + cta_12_8)_TTM
--     / ((cta_1 - cta_2) + (cta_6 - cta_7))_TTM
--
--   % INOF Neto / Ingresos Totales (r685 indirectamente):
--     INOF Neto = (cta_6 - cta_7)_TTM
--     Ingresos Totales (r683) = cta_1_TTM + cta_6_TTM + MAX(0, cta_5_TTM + cta_13_TTM)
--
-- Patrón TTM (V034): ttm(M) = ytd(M) + ytd(Dic_prev) - ytd(M_prev_year)
-- =========================================================================

-- Helper genérico: promedio 12m de una cuenta del balance.
-- Toma valor del balance al cierre de cada mes en los últimos 12 meses
-- (incluyendo el actual) y promedia. Si faltan meses, usa los disponibles.
CREATE OR REPLACE FUNCTION marts.balance_prom_12m(
    _periodo INT,
    _nomb_correg TEXT,
    _moneda TEXT,
    _columna TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _suma NUMERIC := 0;
    _n INT := 0;
    _row RECORD;
    _anio INT := _periodo / 100;
    _mes  INT := _periodo % 100;
    _periodo_inicio INT;
    _query TEXT;
BEGIN
    -- 12 meses calendario hacia atrás (Ej. Abr-20 -> May-19..Abr-20)
    _periodo_inicio := CASE WHEN _mes = 12 THEN _periodo - 11
                            ELSE (_anio - 1) * 100 + (_mes + 1) END;

    _query := format(
        'SELECT %I AS valor FROM marts.v_eeff_balance_ancho
         WHERE nomb_correg=$1 AND moneda=$2 AND periodo >= $3 AND periodo <= $4 ORDER BY periodo',
        _columna
    );

    FOR _row IN EXECUTE _query USING _nomb_correg, _moneda, _periodo_inicio, _periodo
    LOOP
        IF _row.valor IS NOT NULL THEN
            _suma := _suma + _row.valor;
            _n := _n + 1;
        END IF;
    END LOOP;

    IF _n = 0 THEN RETURN NULL; END IF;
    RETURN _suma / _n;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.balance_prom_12m IS
    'Promedio simple en últimos 12 meses de cualquier columna del balance '
    '(ej cta_a, cta_c). Replica r514/r526 del Excel.';


-- Helper: cartera bruta promedio 12m (vigente + refinanciada + atrasada)
CREATE OR REPLACE FUNCTION marts.cartera_bruta_prom_12m(
    _periodo INT,
    _nomb_correg TEXT,
    _moneda TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _suma NUMERIC := 0;
    _n INT := 0;
    _anio INT := _periodo / 100;
    _mes  INT := _periodo % 100;
    _periodo_inicio INT;
    _row RECORD;
BEGIN
    _periodo_inicio := CASE WHEN _mes = 12 THEN _periodo - 11
                            ELSE (_anio - 1) * 100 + (_mes + 1) END;

    FOR _row IN
        SELECT (COALESCE(cta_a4_1,0) + COALESCE(cta_a4_2,0) + COALESCE(cta_a4_3,0)) AS cb
        FROM marts.v_eeff_balance_ancho
        WHERE nomb_correg = _nomb_correg AND moneda = _moneda
          AND periodo >= _periodo_inicio AND periodo <= _periodo
        ORDER BY periodo
    LOOP
        IF _row.cb IS NOT NULL AND _row.cb > 0 THEN
            _suma := _suma + _row.cb;
            _n := _n + 1;
        END IF;
    END LOOP;

    IF _n = 0 THEN RETURN NULL; END IF;
    RETURN _suma / _n;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------- VISTA DE KPIs ANUALES POR ENTIDAD/PERIODO ----------
-- Computa TTM y promedios 12m para cada combinación que aparezca en
-- mv_eeff_resultados_ancho. Granularidad: (periodo, nomb_correg).
CREATE OR REPLACE VIEW marts.v_kpis_anuales_entidad AS
SELECT
    e.periodo,
    e.nomb_correg,
    -- TTM cuentas ER (numeradores)
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_17')   AS utilidad_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_1')    AS cta_1_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_2')    AS cta_2_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_6')    AS cta_6_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_7')    AS cta_7_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_1') AS cta_10_1_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_2') AS cta_10_2_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_3') AS cta_10_3_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_4') AS cta_10_4_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_12_7') AS cta_12_7_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_12_8') AS cta_12_8_ttm,
    -- Promedios 12m del balance (denominadores ROE/ROA)
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_a') AS activos_prom_12m,
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_c') AS patrimonio_prom_12m,
    marts.cartera_bruta_prom_12m(e.periodo, e.nomb_correg, 'TOTAL')    AS cartera_prom_12m
FROM (
    SELECT DISTINCT periodo, nomb_correg
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
) e;

COMMENT ON VIEW marts.v_kpis_anuales_entidad IS
    'Componentes TTM y promedios 12m para KPIs anuales del cuadro resumen '
    '(Utilidad, ROE, ROA, Gastos Op / Margen, INOF / Ingresos). Una fila '
    'por (periodo, nomb_correg). Performance: indices materializados en '
    'mv_eeff_resultados_ancho hacen los ttm_resultados rapidos.';
