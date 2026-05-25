-- =========================================================================
-- V072: Fix marts.v_kpis_anuales_entidad para que use el CANONICO actual
-- como nomb_correg.
--
-- Bug: la vista hacia SELECT DISTINCT periodo, nomb_correg FROM mv_eeff_resultados_ancho
-- sin canonizar. En 202004 Compartamos tenia nomb_correg='Financiera Compartamos'
-- y el JOIN del cuadro resumen (consolidar=true) buscaba 'Compartamos Banco' (canonico)
-- -> no encuentra -> Utilidad/ROE/ROA/Gastos Op/INOF salian vacios.
--
-- Fix: la vista ahora agrupa por dw.resolver_nomb_correg_canonico(nomb_correg).
-- ttm_resultados/balance_prom_12m reciben el canonico y deben buscar los
-- valores en mv_eeff por TODOS los nombres historicos que apunten a ese
-- canonico. Como ttm_resultados ya consulta nomb_correg literal, necesitamos
-- envolver con un join a entidad_renombre para sumar las contribuciones.
--
-- Solucion: helper marts.ttm_resultados_canonico que itera sobre todos los
-- nombres historicos de la entidad y suma sus contribuciones.
-- =========================================================================

CREATE OR REPLACE FUNCTION marts.ttm_resultados_canonico(
    _periodo INT,
    _canonico TEXT,
    _moneda TEXT,
    _columna TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _total NUMERIC := 0;
    _hay BOOLEAN := FALSE;
    _row RECORD;
    _val NUMERIC;
BEGIN
    -- Iterar sobre todos los nombres historicos cuyo canonico final sea _canonico
    FOR _row IN
        SELECT DISTINCT nomb_correg
        FROM marts.mv_eeff_resultados_ancho
        WHERE moneda = _moneda
          AND nomb_correg IS NOT NULL
          AND dw.resolver_nomb_correg_canonico(nomb_correg) = _canonico
    LOOP
        _val := marts.ttm_resultados(_periodo, _row.nomb_correg, _moneda, _columna);
        IF _val IS NOT NULL THEN
            _total := _total + _val;
            _hay := TRUE;
        END IF;
    END LOOP;
    IF NOT _hay THEN RETURN NULL; END IF;
    RETURN _total;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.ttm_resultados_canonico IS
    'TTM (trailing 12m) consolidando todos los nombres historicos de una '
    'entidad. Suma los flujos de la entidad bajo cualquier nombre que '
    'resuelva al canonico actual. Usar en vistas canonicas (no historicas).';


CREATE OR REPLACE FUNCTION marts.balance_prom_12m_canonico(
    _periodo INT,
    _canonico TEXT,
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
    _periodo_inicio := CASE WHEN _mes = 12 THEN _periodo - 11
                            ELSE (_anio - 1) * 100 + (_mes + 1) END;

    _query := format(
        'SELECT periodo, SUM(%I) AS valor FROM marts.v_eeff_balance_ancho
         WHERE moneda=$1 AND nomb_correg IS NOT NULL
           AND dw.resolver_nomb_correg_canonico(nomb_correg) = $2
           AND periodo BETWEEN $3 AND $4
         GROUP BY periodo ORDER BY periodo',
        _columna
    );

    FOR _row IN EXECUTE _query USING _moneda, _canonico, _periodo_inicio, _periodo
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

COMMENT ON FUNCTION marts.balance_prom_12m_canonico IS
    'Promedio 12m consolidando todos los nombres historicos de una entidad.';


-- ---------- REEMPLAZAR v_kpis_anuales_entidad ----------
DROP VIEW IF EXISTS marts.v_kpis_anuales_entidad CASCADE;
CREATE VIEW marts.v_kpis_anuales_entidad AS
WITH canonicos AS (
    SELECT DISTINCT
        periodo,
        dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
)
SELECT
    c.periodo,
    c.nomb_correg,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_17')   AS utilidad_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_1')    AS cta_1_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_2')    AS cta_2_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_6')    AS cta_6_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_7')    AS cta_7_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_10_1') AS cta_10_1_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_10_2') AS cta_10_2_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_10_3') AS cta_10_3_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_10_4') AS cta_10_4_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_12_7') AS cta_12_7_ttm,
    marts.ttm_resultados_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_12_8') AS cta_12_8_ttm,
    marts.balance_prom_12m_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_a') AS activos_prom_12m,
    marts.balance_prom_12m_canonico(c.periodo, c.nomb_correg, 'TOTAL', 'cta_c') AS patrimonio_prom_12m
FROM canonicos c;
