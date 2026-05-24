-- =========================================================================
-- V057: Tabla maestra HISTORICA de entidades microfinancieras
--
-- Regla de oro (Sistema Microfinanciero - SMF):
--   Una entidad pertenece al SMF en el periodo P si y solo si:
--      (saldo Pequena Empresa + saldo Microempresa) / saldo total cartera
--      >= 50% en el periodo P.
--
-- La clasificacion es MENSUAL y puede cambiar entre periodos. Por eso
-- esta tabla guarda flag + porcentaje por (entidad, periodo) para usar
-- en informes consolidados y benchmarks.
--
-- Ejemplos validados:
--  - Mibanco Set-2022: ~88% MYPE -> es_microfinanciera = TRUE
--  - Compartamos Banco actual: >90% MYPE -> TRUE
--  - BCP: ~10% MYPE -> FALSE
-- =========================================================================

CREATE TABLE IF NOT EXISTS dw.entidad_microfinanciera_periodo (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,                  -- YYYYMM
    nomb_correg         TEXT NOT NULL,                  -- entidad consolidada (canonico)
    pct_cartera_mype    NUMERIC(6,4) NOT NULL,          -- 0..1
    saldo_mype          NUMERIC(20,4) NOT NULL,         -- en miles soles
    saldo_total         NUMERIC(20,4) NOT NULL,         -- en miles soles
    es_microfinanciera  BOOLEAN NOT NULL,               -- regla 50%
    umbral_pct          NUMERIC(4,2) NOT NULL DEFAULT 0.5000,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT smf_unique UNIQUE (periodo, nomb_correg)
);
CREATE INDEX IF NOT EXISTS idx_smf_periodo
    ON dw.entidad_microfinanciera_periodo (periodo);
CREATE INDEX IF NOT EXISTS idx_smf_es_mfi
    ON dw.entidad_microfinanciera_periodo (es_microfinanciera) WHERE es_microfinanciera;

COMMENT ON TABLE dw.entidad_microfinanciera_periodo IS
    'Clasificacion mensual de entidades en Sistema Microfinanciero (SMF). '
    'Regla: cartera (Pequena Empresa + Microempresa) >= 50% de cartera total.';
COMMENT ON COLUMN dw.entidad_microfinanciera_periodo.pct_cartera_mype IS
    'Porcentaje de cartera dedicada a MYPE en el periodo (0..1).';


-- ---------- FUNCION DE COMPUTO ----------
CREATE OR REPLACE FUNCTION dw.recalcular_microfinancieras(p_periodo INT DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    n_inserted INT;
BEGIN
    -- Borra el periodo a recalcular (o todos si NULL)
    IF p_periodo IS NULL THEN
        DELETE FROM dw.entidad_microfinanciera_periodo;
    ELSE
        DELETE FROM dw.entidad_microfinanciera_periodo WHERE periodo = p_periodo;
    END IF;

    INSERT INTO dw.entidad_microfinanciera_periodo (
        periodo, nomb_correg, pct_cartera_mype,
        saldo_mype, saldo_total, es_microfinanciera
    )
    WITH base AS (
        SELECT
            c.periodo,
            dw.resolver_nomb_correg_canonico(c.empresa) AS nomb_correg,
            -- Strip diacriticos para matchear "Pequena Empresa" o "Peque�a Empresa"
            CASE
                WHEN LOWER(TRIM(c.producto)) IN ('microempresa', 'a microempresas')
                  OR LOWER(TRIM(c.producto)) LIKE 'peque%empresa%'
                THEN c.saldo_total
                ELSE 0
            END AS saldo_mype_row,
            c.saldo_total AS saldo_total_row
        FROM raw.colocaciones_observacion c
        WHERE c.empresa IS NOT NULL
          AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
          AND c.saldo_total IS NOT NULL
          AND (p_periodo IS NULL OR c.periodo = p_periodo)
    ),
    agg AS (
        SELECT
            periodo,
            nomb_correg,
            SUM(saldo_mype_row)  AS saldo_mype,
            SUM(saldo_total_row) AS saldo_total
        FROM base
        GROUP BY periodo, nomb_correg
        HAVING SUM(saldo_total_row) > 0
    )
    SELECT
        periodo,
        nomb_correg,
        ROUND((saldo_mype / saldo_total)::numeric, 4),
        saldo_mype,
        saldo_total,
        (saldo_mype / saldo_total) >= 0.5
    FROM agg;

    GET DIAGNOSTICS n_inserted = ROW_COUNT;
    RETURN n_inserted;
END $$;

COMMENT ON FUNCTION dw.recalcular_microfinancieras(INT) IS
    'Recalcula la clasificacion SMF para un periodo (o todos si NULL). '
    'Usar luego de cargar raw.colocaciones_observacion de un nuevo mes.';


-- ---------- VISTA CONVENIENCIA ----------
CREATE OR REPLACE VIEW marts.v_microfinancieras_periodo AS
SELECT
    periodo,
    nomb_correg,
    pct_cartera_mype,
    es_microfinanciera,
    saldo_mype,
    saldo_total
FROM dw.entidad_microfinanciera_periodo
ORDER BY periodo DESC, pct_cartera_mype DESC;


-- ---------- COMPUTO INICIAL: TODOS LOS PERIODOS ----------
SELECT dw.recalcular_microfinancieras(NULL) AS rows_inserted;
