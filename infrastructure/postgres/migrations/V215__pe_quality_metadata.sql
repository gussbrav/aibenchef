-- =========================================================================
-- V215: Metadata de calidad de datos para Punto de Equilibrio
--
-- PROBLEMA
--   V214 agregó fallback YTD anualizado (YTD×12/M) para periodos sin
--   prior-year data. Pero no distinguimos la CALIDAD de cada cálculo:
--
--   - Un COOPAC N1 mensual con 12 obs de balance en la ventana 12m
--     produce un cartera_prom confiable.
--   - Un COOPAC N3 anual con 1 obs produce un cartera_prom que es
--     literalmente un solo punto — expuesto a cualquier anomalía de ese
--     mes.
--   - Un COOPAC nuevo con cartera que creció 200% en el primer mes genera
--     ratios distorsionados sin que podamos filtrarlos.
--
-- SOLUCIÓN
--   Tabla paralela marts.fact_pe_metadata con metadata por (periodo, entidad,
--   moneda). La UI deriva un "tier de calidad" a partir de:
--     - metodo_calculo: 'ttm_exacto' | 'ytd_anualizado'
--     - cartera_obs: cuántas observaciones de balance entraron al promedio
--
--   Tiers (derivados en el frontend):
--     - exacto        : TTM completo + cartera_obs ≥ 2 — sin marca
--     - estimado      : Anualizado + cartera_obs ≥ 2 — asterisco + nota pie
--     - parcial       : cartera_obs < 2 — doble asterisco + warning
--     - invalido      : ya filtrado en la función (no se inserta)
--
-- DISEÑO
--   Tabla separada en lugar de agregar KPIs "pe_meta_*" para no mezclar
--   metadata de calidad con KPIs de negocio (SRP: la tabla de KPIs es
--   para KPIs, la de metadata para metadata).
--
-- IDEMPOTENCIA
--   CREATE TABLE IF NOT EXISTS, UPSERT via ON CONFLICT.
-- =========================================================================

-- -----------------------------------------------------------------------
-- 1. Tabla de metadata
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marts.fact_pe_metadata (
    periodo        INT  NOT NULL,
    nomb_correg    TEXT NOT NULL,
    moneda         TEXT NOT NULL DEFAULT 'TOTAL'
                   CHECK (moneda IN ('MN', 'ME', 'TOTAL')),
    metodo_calculo TEXT NOT NULL
                   CHECK (metodo_calculo IN ('ttm_exacto', 'ytd_anualizado')),
    cartera_obs    INT  NOT NULL CHECK (cartera_obs >= 0),
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (periodo, nomb_correg, moneda)
);

CREATE INDEX IF NOT EXISTS idx_fact_pe_metadata_periodo
    ON marts.fact_pe_metadata (periodo);

COMMENT ON TABLE  marts.fact_pe_metadata IS
    'Metadata de calidad de los KPIs de Punto de Equilibrio. 1 fila por (periodo, entidad, moneda).';
COMMENT ON COLUMN marts.fact_pe_metadata.metodo_calculo IS
    'ttm_exacto = TTM con ambos prior periods disponibles. ytd_anualizado = fallback YTD×12/M.';
COMMENT ON COLUMN marts.fact_pe_metadata.cartera_obs IS
    'Observaciones de balance (cta_a4_1+a4_2+a4_3 > 0) en la ventana 12m usadas para el promedio.';

-- -----------------------------------------------------------------------
-- 2. Helper: cartera_promedio_12m_con_meta
--    Devuelve cartera_prom y cartera_obs en un solo call.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marts.cartera_promedio_12m_con_meta(
    _periodo INT, _nomb_correg TEXT, _moneda TEXT
) RETURNS TABLE(cartera_prom NUMERIC, cartera_obs INT) AS $$
DECLARE
    _mes            INT := _periodo % 100;
    _periodo_inicio INT := CASE WHEN _mes = 12
                                 THEN _periodo - 11
                                 ELSE (_periodo / 100 - 1) * 100 + (_mes + 1)
                            END;
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
          AND periodo    BETWEEN _periodo_inicio AND _periodo
    ) t
    WHERE v > 0;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.cartera_promedio_12m_con_meta IS
    'Como cartera_promedio_12m pero devuelve tambien el conteo de observaciones usadas.';

-- -----------------------------------------------------------------------
-- 3. compute_kpis_PE actualizada:
--    - Usa el helper para obtener cartera_obs de una vez.
--    - Determina metodo_calculo via EXISTS sobre los prior periods.
--    - Sanity check: skip si rendimiento fuera de [0, 3]
--      (300% cubre consumer credit en Perú; valores fuera son bugs).
--    - Upsert metadata en fact_pe_metadata + kpis en fact_kpis_mensuales.
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
        SELECT c.cartera_prom, c.cartera_obs
          INTO _cartera_prom, _cartera_obs
        FROM marts.cartera_promedio_12m_con_meta(_periodo, _entidad.nomb_correg, _moneda) c;

        IF _cartera_prom IS NULL OR _cartera_prom = 0 THEN CONTINUE; END IF;

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

        -- Sanity check: rendimiento fuera de [0, 3] indica datos corruptos
        -- (entidad nueva con cartera inicial muy pequeña que explota el
        -- ratio, o cuenta de ingresos mal clasificada).
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

        INSERT INTO marts.fact_pe_metadata (periodo, nomb_correg, moneda, metodo_calculo, cartera_obs)
        VALUES (_periodo, _entidad.nomb_correg, _moneda, _metodo, _cartera_obs)
        ON CONFLICT (periodo, nomb_correg, moneda) DO UPDATE SET
            metodo_calculo = EXCLUDED.metodo_calculo,
            cartera_obs    = EXCLUDED.cartera_obs,
            computed_at    = now();

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
    'Computa 10 KPIs PE + metadata de calidad. TTM exacto si hay prior-year; YTD×12/M como fallback. Skip si rendimiento fuera [0, 3].';

-- -----------------------------------------------------------------------
-- 4. Backfill de metadata para KPIs ya existentes.
--    Derivado por inspección de la MV — no requiere recorrer la función.
-- -----------------------------------------------------------------------
INSERT INTO marts.fact_pe_metadata (periodo, nomb_correg, moneda, metodo_calculo, cartera_obs)
SELECT
    f.periodo,
    f.nomb_correg,
    f.moneda,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM marts.mv_eeff_resultados_ancho r
            WHERE r.periodo = (f.periodo / 100 - 1) * 100 + 12
              AND r.nomb_correg = f.nomb_correg AND r.moneda = f.moneda
        )
         AND EXISTS (
            SELECT 1 FROM marts.mv_eeff_resultados_ancho r
            WHERE r.periodo = (f.periodo / 100 - 1) * 100 + (f.periodo % 100)
              AND r.nomb_correg = f.nomb_correg AND r.moneda = f.moneda
        )
        THEN 'ttm_exacto'
        ELSE 'ytd_anualizado'
    END AS metodo_calculo,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM marts.v_eeff_balance_ancho b
        WHERE b.nomb_correg = f.nomb_correg
          AND b.moneda      = f.moneda
          AND b.periodo    <= f.periodo
          AND b.periodo    >= CASE
                                WHEN f.periodo % 100 = 12 THEN f.periodo - 11
                                ELSE (f.periodo / 100 - 1) * 100 + (f.periodo % 100 + 1)
                              END
          AND (COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0)
             + COALESCE(b.cta_a4_3, 0)) > 0
    ), 0) AS cartera_obs
FROM marts.fact_kpis_mensuales f
WHERE f.kpi_codigo = 'pe_rendimiento_cartera'
  AND f.moneda     = 'TOTAL'
ON CONFLICT (periodo, nomb_correg, moneda) DO UPDATE SET
    metodo_calculo = EXCLUDED.metodo_calculo,
    cartera_obs    = EXCLUDED.cartera_obs,
    computed_at    = now();

-- -----------------------------------------------------------------------
-- 5. Limpieza de KPIs invalidos existentes (rendimiento fuera de [0, 3]).
--    Estos son datos pre-V215 que colaron por un bug o entidad nueva con
--    cartera minuscula. Mejor que la UI los oculte: los borramos.
-- -----------------------------------------------------------------------
DELETE FROM marts.fact_kpis_mensuales
WHERE kpi_codigo LIKE 'pe_%'
  AND (periodo, nomb_correg, moneda) IN (
    SELECT periodo, nomb_correg, moneda
    FROM marts.fact_kpis_mensuales
    WHERE kpi_codigo = 'pe_rendimiento_cartera'
      AND (valor < 0 OR valor > 3)
  );

DELETE FROM marts.fact_pe_metadata
WHERE (periodo, nomb_correg, moneda) NOT IN (
    SELECT periodo, nomb_correg, moneda
    FROM marts.fact_kpis_mensuales
    WHERE kpi_codigo = 'pe_rendimiento_cartera'
);
