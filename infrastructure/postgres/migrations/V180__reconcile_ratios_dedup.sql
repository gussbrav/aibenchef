-- =========================================================================
-- V180 — Fix gov.reconcile_ratios: dedup en INSERT
-- =========================================================================
--
-- Bug 2026-08-19 al correr por primera vez la reconciliacion:
--   ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- Causa: v_indicadores_ancho hace LEFT JOIN a dw.entidad_nombre para
-- canonizar. Si una entidad tiene multiples nombres registrados (canonico
-- + historico + alias + rebranding), el JOIN produce N filas por
-- (periodo, entidad conceptual) — todas con el mismo nomb_correg_canonico.
-- El FULL OUTER JOIN con mv_kpis_anuales_entidad entonces duplica, y
-- el INSERT trata de meter 2+ filas con la misma PK (periodo, nomb_correg,
-- indicador). ON CONFLICT DO UPDATE explota porque no puede tocar la
-- misma row 2 veces en el mismo comando.
--
-- Fix: agrupar en CTE antes del INSERT. Usamos MAX() como agregador —
-- si hay duplicados de la misma entidad, los valores deben ser IGUALES
-- (misma fuente de data), MAX es equivalente a "cualquier valor" y es
-- deterministico.
--
-- Idempotente (CREATE OR REPLACE FUNCTION).
-- =========================================================================

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

    -- ------ ROA ------
    -- CTE agrega por nomb_correg canonico (dedup de multiples nombres
    -- que apuntan a la misma entidad en v_indicadores_ancho).
    WITH k_agg AS (
        SELECT nomb_correg,
               MAX(utilidad_ttm)      AS utilidad_ttm,
               MAX(activos_prom_12m)  AS activos_prom_12m,
               MAX(patrimonio_prom_12m) AS patrimonio_prom_12m
          FROM marts.mv_kpis_anuales_entidad
         WHERE periodo = v_periodo
         GROUP BY nomb_correg
    ),
    i_agg AS (
        SELECT nomb_correg,
               MAX(roa_sbs) AS roa_sbs,
               MAX(roe_sbs) AS roe_sbs,
               MAX(mora_atrasados_sobre_directos) AS mora_atrasados_sobre_directos
          FROM marts.v_indicadores_ancho
         WHERE periodo = v_periodo
         GROUP BY nomb_correg
    )
    INSERT INTO gov.ratio_reconciliation
        (periodo, nomb_correg, indicador, derived_value, sbs_value, delta_bps, sbs_seen_at, last_reconciled_at)
    SELECT
        v_periodo,
        COALESCE(k.nomb_correg, i.nomb_correg),
        'roa',
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
      FROM k_agg k
      FULL OUTER JOIN i_agg i ON i.nomb_correg = k.nomb_correg
     WHERE COALESCE(k.nomb_correg, i.nomb_correg) IS NOT NULL
    ON CONFLICT (periodo, nomb_correg, indicador) DO UPDATE
        SET derived_value      = EXCLUDED.derived_value,
            sbs_value          = EXCLUDED.sbs_value,
            delta_bps          = EXCLUDED.delta_bps,
            sbs_seen_at        = COALESCE(gov.ratio_reconciliation.sbs_seen_at, EXCLUDED.sbs_seen_at),
            last_reconciled_at = EXCLUDED.last_reconciled_at;

    -- ------ ROE ------
    WITH k_agg AS (
        SELECT nomb_correg,
               MAX(utilidad_ttm)      AS utilidad_ttm,
               MAX(patrimonio_prom_12m) AS patrimonio_prom_12m
          FROM marts.mv_kpis_anuales_entidad
         WHERE periodo = v_periodo
         GROUP BY nomb_correg
    ),
    i_agg AS (
        SELECT nomb_correg, MAX(roe_sbs) AS roe_sbs
          FROM marts.v_indicadores_ancho
         WHERE periodo = v_periodo
         GROUP BY nomb_correg
    )
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
      FROM k_agg k
      FULL OUTER JOIN i_agg i ON i.nomb_correg = k.nomb_correg
     WHERE COALESCE(k.nomb_correg, i.nomb_correg) IS NOT NULL
    ON CONFLICT (periodo, nomb_correg, indicador) DO UPDATE
        SET derived_value      = EXCLUDED.derived_value,
            sbs_value          = EXCLUDED.sbs_value,
            delta_bps          = EXCLUDED.delta_bps,
            sbs_seen_at        = COALESCE(gov.ratio_reconciliation.sbs_seen_at, EXCLUDED.sbs_seen_at),
            last_reconciled_at = EXCLUDED.last_reconciled_at;

    -- ------ Mora atrasados / directos ------
    WITH r_agg AS (
        SELECT nomb_correg, MAX(ratio_mora) AS ratio_mora
          FROM marts.mv_eeff_ratios
         WHERE periodo = v_periodo
           AND (moneda IS NULL OR moneda = 'TOTAL')
         GROUP BY nomb_correg
    ),
    i_agg AS (
        SELECT nomb_correg, MAX(mora_atrasados_sobre_directos) AS mora_atrasados_sobre_directos
          FROM marts.v_indicadores_ancho
         WHERE periodo = v_periodo
         GROUP BY nomb_correg
    )
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
      FROM r_agg r
      FULL OUTER JOIN i_agg i ON i.nomb_correg = r.nomb_correg
     WHERE COALESCE(r.nomb_correg, i.nomb_correg) IS NOT NULL
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
    'V180: dedup con CTE agg antes del INSERT. Fix del bug ON CONFLICT '
    'cannot affect row a second time cuando v_indicadores_ancho tiene '
    'multiples nombres apuntando a la misma entidad canonica.';
