-- =========================================================================
-- V177: Reconciliacion de ratios propios vs los publicados por SBS
--
-- Contexto: mostramos SIEMPRE nuestros ratios calculados (ROA, ROE, Mora
-- criterio SBS) al usuario. SBS publica los mismos indicadores en el
-- Excel mensual "indicadores prudenciales". Usamos esa publicacion SOLO
-- como termometro de calidad: si nuestro calculo diverge del oficial por
-- mas de N bps, hay algo que revisar (bug, edge case, o SBS cambio
-- metodologia).
--
-- Cero impacto en la UX del usuario final — esto es QA interno.
--
-- Diseno:
--   1. gov.ratio_reconciliation: 1 fila por (periodo, entidad, indicador)
--      con derived_value, sbs_value, delta_bps.
--   2. gov.reconcile_ratios(periodo): computa reconciliacion para 1 periodo.
--      Idempotente. Se corre despues de la ingesta prudencial.
--   3. gov.v_ratio_divergences: filas con |delta_bps| > threshold.
--   4. gov.v_ratio_reconciliation_summary: metrica de accuracy por
--      indicador (%_dentro_tolerancia ultimos 12 periodos).
--
-- Aplica a 3 indicadores iniciales:
--   - roa (utilidad_ttm / activos_prom_12m) vs roa_sbs
--   - roe (utilidad_ttm / patrimonio_prom_12m) vs roe_sbs
--   - mora_atrasados_directos (cta_a4_3 / cartera_bruta) vs mora_atrasados_sobre_directos
--
-- Threshold defecto: 5 bps (1 bp = 0.01%). Configurable via UPDATE.
-- =========================================================================

-- ============ TABLA ============

CREATE TABLE IF NOT EXISTS gov.ratio_reconciliation (
    periodo             INT NOT NULL,
    nomb_correg         TEXT NOT NULL,
    indicador           TEXT NOT NULL
                        CHECK (indicador IN ('roa', 'roe', 'mora_atrasados_directos')),
    -- Ambos valores en porcentaje (3.41 = 3.41%). NULL si no hay data
    -- de ese lado (todavia).
    derived_value       NUMERIC(10, 4),
    sbs_value           NUMERIC(10, 4),
    -- Delta en basis points (100 bps = 1%). SBS - derived. Positivo =
    -- SBS mayor que nuestro. Solo calculado si ambos valores presentes.
    delta_bps           INT,
    -- Timestamps de trazabilidad
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_reconciled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sbs_seen_at         TIMESTAMPTZ,
    -- Notas manuales para casos con explicacion conocida (ej. "SBS
    -- consolida sucursales exterior, nuestro dato es solo local")
    notas               TEXT,
    PRIMARY KEY (periodo, nomb_correg, indicador)
);

CREATE INDEX IF NOT EXISTS idx_ratio_reconciliation_periodo
    ON gov.ratio_reconciliation (periodo DESC);
CREATE INDEX IF NOT EXISTS idx_ratio_reconciliation_divergentes
    ON gov.ratio_reconciliation (periodo DESC, ABS(delta_bps) DESC)
    WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL;

COMMENT ON TABLE gov.ratio_reconciliation IS
    'QA interno: comparamos nuestro calculo vs el ratio SBS oficial. Al '
    'usuario le mostramos siempre nuestro derivado; este registro sirve '
    'para detectar drift/bugs cuando SBS publica su valor. Populada por '
    'gov.reconcile_ratios(periodo) despues de la ingesta prudencial.';

COMMENT ON COLUMN gov.ratio_reconciliation.delta_bps IS
    'Diferencia en basis points: SBS - derived. Positivo = subestimamos. '
    'Rango tipico esperado: -5 a +5 bps. Fuera de eso, revisar.';


-- ============ FUNCION ============

CREATE OR REPLACE FUNCTION gov.reconcile_ratios(p_periodo INT DEFAULT NULL)
RETURNS TABLE (
    periodo_out       INT,
    reconciled_count  INT,
    divergence_count  INT,
    by_indicador      JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_periodo   INT;
    v_recon     INT;
    v_diverg    INT;
    v_by_ind    JSONB;
    THRESHOLD_BPS CONSTANT INT := 5;
BEGIN
    -- Determinar periodo objetivo: el argumento, o el ultimo con datos SBS
    IF p_periodo IS NULL THEN
        SELECT MAX(i.periodo) INTO v_periodo
          FROM marts.v_indicadores_ancho i
         WHERE i.roa_sbs IS NOT NULL;
        IF v_periodo IS NULL THEN
            RAISE NOTICE 'gov.reconcile_ratios: no hay data SBS aun — skip';
            RETURN QUERY SELECT NULL::INT, 0, 0, '{}'::jsonb;
            RETURN;
        END IF;
    ELSE
        v_periodo := p_periodo;
    END IF;

    -- Insert/update las 3 tipos de indicadores en 1 pasada por indicador.
    -- Usamos FULL JOIN para capturar entidades que estan en un lado y no
    -- en el otro (ej. entidad chica sin publicacion prudencial).

    -- ------ ROA ------
    INSERT INTO gov.ratio_reconciliation
        (periodo, nomb_correg, indicador, derived_value, sbs_value, delta_bps, sbs_seen_at, last_reconciled_at)
    SELECT
        v_periodo,
        COALESCE(k.nomb_correg, i.nomb_correg),
        'roa',
        -- derived en % (fraccion * 100)
        CASE
            WHEN k.utilidad_ttm IS NULL OR k.activos_prom_12m IS NULL OR k.activos_prom_12m = 0
                THEN NULL
            ELSE ROUND((k.utilidad_ttm::numeric / k.activos_prom_12m * 100), 4)
        END,
        i.roa_sbs,
        CASE
            WHEN k.utilidad_ttm IS NULL OR k.activos_prom_12m IS NULL OR k.activos_prom_12m = 0
                 OR i.roa_sbs IS NULL
                THEN NULL
            ELSE ROUND((i.roa_sbs - (k.utilidad_ttm::numeric / k.activos_prom_12m * 100)) * 100)::int
        END,
        CASE WHEN i.roa_sbs IS NOT NULL THEN now() ELSE NULL END,
        now()
      FROM marts.mv_kpis_anuales_entidad k
      FULL OUTER JOIN marts.v_indicadores_ancho i
        ON i.periodo = k.periodo AND i.nomb_correg = k.nomb_correg
     WHERE COALESCE(k.periodo, i.periodo) = v_periodo
    ON CONFLICT (periodo, nomb_correg, indicador) DO UPDATE
        SET derived_value      = EXCLUDED.derived_value,
            sbs_value          = EXCLUDED.sbs_value,
            delta_bps          = EXCLUDED.delta_bps,
            sbs_seen_at        = COALESCE(gov.ratio_reconciliation.sbs_seen_at, EXCLUDED.sbs_seen_at),
            last_reconciled_at = EXCLUDED.last_reconciled_at;

    -- ------ ROE ------
    INSERT INTO gov.ratio_reconciliation
        (periodo, nomb_correg, indicador, derived_value, sbs_value, delta_bps, sbs_seen_at, last_reconciled_at)
    SELECT
        v_periodo,
        COALESCE(k.nomb_correg, i.nomb_correg),
        'roe',
        CASE
            WHEN k.utilidad_ttm IS NULL OR k.patrimonio_prom_12m IS NULL OR k.patrimonio_prom_12m = 0
                THEN NULL
            ELSE ROUND((k.utilidad_ttm::numeric / k.patrimonio_prom_12m * 100), 4)
        END,
        i.roe_sbs,
        CASE
            WHEN k.utilidad_ttm IS NULL OR k.patrimonio_prom_12m IS NULL OR k.patrimonio_prom_12m = 0
                 OR i.roe_sbs IS NULL
                THEN NULL
            ELSE ROUND((i.roe_sbs - (k.utilidad_ttm::numeric / k.patrimonio_prom_12m * 100)) * 100)::int
        END,
        CASE WHEN i.roe_sbs IS NOT NULL THEN now() ELSE NULL END,
        now()
      FROM marts.mv_kpis_anuales_entidad k
      FULL OUTER JOIN marts.v_indicadores_ancho i
        ON i.periodo = k.periodo AND i.nomb_correg = k.nomb_correg
     WHERE COALESCE(k.periodo, i.periodo) = v_periodo
    ON CONFLICT (periodo, nomb_correg, indicador) DO UPDATE
        SET derived_value      = EXCLUDED.derived_value,
            sbs_value          = EXCLUDED.sbs_value,
            delta_bps          = EXCLUDED.delta_bps,
            sbs_seen_at        = COALESCE(gov.ratio_reconciliation.sbs_seen_at, EXCLUDED.sbs_seen_at),
            last_reconciled_at = EXCLUDED.last_reconciled_at;

    -- ------ Mora atrasados / directos ------
    -- Nuestro: r.ratio_mora en marts.mv_eeff_ratios (moneda TOTAL) — fraccion
    -- SBS: mora_atrasados_sobre_directos en v_indicadores_ancho — porcentaje
    INSERT INTO gov.ratio_reconciliation
        (periodo, nomb_correg, indicador, derived_value, sbs_value, delta_bps, sbs_seen_at, last_reconciled_at)
    SELECT
        v_periodo,
        COALESCE(r.nomb_correg, i.nomb_correg),
        'mora_atrasados_directos',
        CASE
            WHEN r.ratio_mora IS NULL THEN NULL
            ELSE ROUND((r.ratio_mora::numeric * 100), 4)
        END,
        i.mora_atrasados_sobre_directos,
        CASE
            WHEN r.ratio_mora IS NULL OR i.mora_atrasados_sobre_directos IS NULL
                THEN NULL
            ELSE ROUND((i.mora_atrasados_sobre_directos - (r.ratio_mora::numeric * 100)) * 100)::int
        END,
        CASE WHEN i.mora_atrasados_sobre_directos IS NOT NULL THEN now() ELSE NULL END,
        now()
      FROM marts.mv_eeff_ratios r
      FULL OUTER JOIN marts.v_indicadores_ancho i
        ON i.periodo = r.periodo AND i.nomb_correg = r.nomb_correg
     WHERE COALESCE(r.periodo, i.periodo) = v_periodo
       AND (r.moneda IS NULL OR r.moneda = 'TOTAL')
    ON CONFLICT (periodo, nomb_correg, indicador) DO UPDATE
        SET derived_value      = EXCLUDED.derived_value,
            sbs_value          = EXCLUDED.sbs_value,
            delta_bps          = EXCLUDED.delta_bps,
            sbs_seen_at        = COALESCE(gov.ratio_reconciliation.sbs_seen_at, EXCLUDED.sbs_seen_at),
            last_reconciled_at = EXCLUDED.last_reconciled_at;

    -- Metricas resumen para el retorno
    SELECT
        COUNT(*)::int,
        COUNT(*) FILTER (
            WHERE sbs_value IS NOT NULL
              AND derived_value IS NOT NULL
              AND ABS(delta_bps) > THRESHOLD_BPS
        )::int
      INTO v_recon, v_diverg
      FROM gov.ratio_reconciliation
     WHERE periodo = v_periodo;

    SELECT COALESCE(jsonb_object_agg(indicador, cnt_ind), '{}'::jsonb)
      INTO v_by_ind
      FROM (
        SELECT indicador, COUNT(*)::int AS cnt_ind
          FROM gov.ratio_reconciliation
         WHERE periodo = v_periodo
         GROUP BY indicador
      ) g;

    RETURN QUERY SELECT v_periodo, COALESCE(v_recon, 0), COALESCE(v_diverg, 0), COALESCE(v_by_ind, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION gov.reconcile_ratios(INT) IS
    'Reconcilia nuestros ratios calculados vs los publicados por SBS para '
    'el periodo indicado (o el ultimo con data SBS si NULL). Idempotente. '
    'Popula gov.ratio_reconciliation. Se llama desde scripts/reconcile-ratios.ts '
    'o desde el importer prudencial cuando termina.';


-- ============ VISTAS ============

-- Divergencias: filas con |delta_bps| > 5 bps (threshold default).
-- Ordenadas por |delta_bps| descendente para triage rapido.
CREATE OR REPLACE VIEW gov.v_ratio_divergences AS
SELECT
    r.periodo,
    r.nomb_correg,
    r.indicador,
    r.derived_value,
    r.sbs_value,
    r.delta_bps,
    ABS(r.delta_bps) AS abs_delta_bps,
    r.sbs_seen_at,
    r.last_reconciled_at,
    r.notas,
    CASE
        WHEN ABS(r.delta_bps) > 50  THEN 'critico'
        WHEN ABS(r.delta_bps) > 20  THEN 'alto'
        WHEN ABS(r.delta_bps) > 5   THEN 'leve'
        ELSE 'ok'
    END AS severidad
  FROM gov.ratio_reconciliation r
 WHERE r.sbs_value IS NOT NULL
   AND r.derived_value IS NOT NULL
   AND ABS(r.delta_bps) > 5
 ORDER BY r.periodo DESC, ABS(r.delta_bps) DESC;

COMMENT ON VIEW gov.v_ratio_divergences IS
    'Casos donde nuestro calculo difiere del SBS oficial por mas de 5 bps. '
    'Alimenta el panel /admin/calidad-datos.';

-- Resumen por indicador: accuracy % ultimos 12 periodos
CREATE OR REPLACE VIEW gov.v_ratio_reconciliation_summary AS
WITH ultimos AS (
    SELECT DISTINCT periodo
      FROM gov.ratio_reconciliation
     ORDER BY periodo DESC
     LIMIT 12
),
base AS (
    SELECT
        r.indicador,
        COUNT(*) FILTER (WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL) AS reconciled,
        COUNT(*) FILTER (
            WHERE sbs_value IS NOT NULL
              AND derived_value IS NOT NULL
              AND ABS(delta_bps) <= 5
        ) AS within_tol,
        AVG(ABS(delta_bps)) FILTER (WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL) AS avg_abs_delta_bps,
        MAX(ABS(delta_bps)) FILTER (WHERE sbs_value IS NOT NULL AND derived_value IS NOT NULL) AS max_abs_delta_bps
      FROM gov.ratio_reconciliation r
     WHERE r.periodo IN (SELECT periodo FROM ultimos)
     GROUP BY r.indicador
)
SELECT
    indicador,
    reconciled,
    within_tol,
    CASE WHEN reconciled = 0 THEN NULL
         ELSE ROUND(within_tol::numeric / reconciled * 100, 2)
    END AS accuracy_pct,
    ROUND(avg_abs_delta_bps, 2) AS avg_abs_delta_bps,
    max_abs_delta_bps
  FROM base
 ORDER BY indicador;

COMMENT ON VIEW gov.v_ratio_reconciliation_summary IS
    'Accuracy score por indicador: % de reconciliaciones dentro de +/-5 bps '
    'en los ultimos 12 periodos. Alerta operativa si baja de 95%.';

-- Pendientes de publicacion SBS (nuestro ratio esta, SBS aun no)
CREATE OR REPLACE VIEW gov.v_ratio_pending_sbs AS
SELECT periodo, nomb_correg, indicador, derived_value, first_seen_at,
       EXTRACT(DAY FROM (now() - first_seen_at))::int AS days_pending
  FROM gov.ratio_reconciliation
 WHERE derived_value IS NOT NULL
   AND sbs_value IS NULL
 ORDER BY periodo DESC, nomb_correg, indicador;

COMMENT ON VIEW gov.v_ratio_pending_sbs IS
    'Ratios que ya calculamos pero SBS aun no publico el oficial. '
    'Informativo para el panel admin: nada que hacer, solo esperar.';
