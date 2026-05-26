-- =========================================================================
-- V079: MV unificada del cuadro resumen (canonico + historica)
--
-- Reemplaza al V076__mv_cuadro_resumen.sql que fallo por timeout cuando se
-- intentaba popular ambas MVs en una sola transaccion.
--
-- Estrategia:
--   1. Canonico: CREATE IF NOT EXISTS (ya poblado en un intento anterior)
--   2. Historica: CREATE ... WITH NO DATA (instant; refresh aparte)
--   3. Refresh function: poblar historica + ambas al ser invocada
--
-- El refresh real se hace fuera de la migracion (cron / boton manual /
-- llamada explicita) para evitar timeouts. Las MVs son utiles vacias
-- porque las queries del dashboard hacen LEFT JOIN, asi el dashboard sigue
-- funcionando con las vistas individuales hasta el primer refresh.
--
-- Despues de aplicar V079 ejecutar (puede tomar 15-30 min):
--   SELECT marts.refresh_cuadro_resumen();
-- =========================================================================

-- ============ CANONICA ============
CREATE MATERIALIZED VIEW IF NOT EXISTS marts.mv_cuadro_resumen_canonico AS
WITH universo AS (
    SELECT DISTINCT periodo, dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg
    FROM marts.v_eeff_balance_ancho
    WHERE moneda='TOTAL' AND nomb_correg IS NOT NULL
    UNION
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_oficinas_por_entidad_canonico
    UNION
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_clientes_por_entidad_canonico
    UNION
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_personal_por_entidad_canonico
)
SELECT
    u.periodo,
    u.nomb_correg,
    bg.cartera_bruta,
    bg.patrimonio,
    bg.activos,
    ofi.n_oficinas,
    cli.n_clientes,
    per.n_personal,
    per.n_empleados,
    smc.pct_part_smf_coloc,
    smd.pct_part_smf_dep,
    mfi.pct_cartera_mype,
    mora.pct_mora_global,
    mora.pct_mora_global_vc,
    cob.pct_cobertura_car,
    k.utilidad_ttm, k.patrimonio_prom_12m, k.activos_prom_12m,
    k.cta_1_ttm, k.cta_2_ttm, k.cta_6_ttm, k.cta_7_ttm,
    k.cta_10_1_ttm, k.cta_10_2_ttm, k.cta_10_3_ttm, k.cta_10_4_ttm,
    k.cta_12_7_ttm, k.cta_12_8_ttm
FROM universo u
LEFT JOIN (
    SELECT periodo, dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           SUM(COALESCE(cta_a4_1,0)+COALESCE(cta_a4_2,0)+COALESCE(cta_a4_3,0)) AS cartera_bruta,
           SUM(cta_c) AS patrimonio,
           SUM(cta_a) AS activos
    FROM marts.v_eeff_balance_ancho
    WHERE moneda='TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY 1, 2
) bg ON bg.periodo = u.periodo AND bg.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_oficinas_por_entidad_canonico ofi
    ON ofi.periodo = u.periodo AND ofi.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_clientes_por_entidad_canonico cli
    ON cli.periodo = u.periodo AND cli.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_personal_por_entidad_canonico per
    ON per.periodo = u.periodo AND per.nomb_correg = u.nomb_correg
LEFT JOIN (
    SELECT periodo, nomb_correg, pct_participacion_smf AS pct_part_smf_coloc
    FROM marts.v_participacion_smf_colocaciones
) smc ON smc.periodo = u.periodo AND smc.nomb_correg = u.nomb_correg
LEFT JOIN (
    SELECT periodo, nomb_correg, pct_participacion_smf AS pct_part_smf_dep
    FROM marts.v_participacion_smf_depositos
) smd ON smd.periodo = u.periodo AND smd.nomb_correg = u.nomb_correg
LEFT JOIN dw.entidad_microfinanciera_periodo mfi
    ON mfi.periodo = u.periodo AND mfi.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_mora_global_por_entidad mora
    ON mora.periodo = u.periodo AND mora.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_cobertura_car_por_entidad cob
    ON cob.periodo = u.periodo AND cob.nomb_correg = u.nomb_correg
LEFT JOIN marts.mv_kpis_anuales_entidad k
    ON k.periodo = u.periodo AND k.nomb_correg = u.nomb_correg
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_cuadro_resumen_canonico_pk
    ON marts.mv_cuadro_resumen_canonico (periodo, nomb_correg);
CREATE INDEX IF NOT EXISTS mv_cuadro_resumen_canonico_periodo
    ON marts.mv_cuadro_resumen_canonico (periodo);


-- ============ HISTORICA ============
CREATE MATERIALIZED VIEW IF NOT EXISTS marts.mv_cuadro_resumen_historica AS
WITH universo AS (
    SELECT DISTINCT periodo, dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg
    FROM marts.v_eeff_balance_ancho
    WHERE moneda='TOTAL' AND nomb_correg IS NOT NULL
    UNION
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_oficinas_por_entidad_historica
    UNION
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_clientes_por_entidad_historica
    UNION
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_personal_por_entidad_historica
)
SELECT
    u.periodo,
    u.nomb_correg,
    bg.cartera_bruta,
    bg.patrimonio,
    bg.activos,
    ofi.n_oficinas,
    cli.n_clientes,
    per.n_personal,
    per.n_empleados,
    smc.pct_part_smf_coloc,
    smd.pct_part_smf_dep,
    mfi.pct_cartera_mype,
    mora.pct_mora_global,
    mora.pct_mora_global_vc,
    cob.pct_cobertura_car,
    k.utilidad_ttm, k.patrimonio_prom_12m, k.activos_prom_12m,
    k.cta_1_ttm, k.cta_2_ttm, k.cta_6_ttm, k.cta_7_ttm,
    k.cta_10_1_ttm, k.cta_10_2_ttm, k.cta_10_3_ttm, k.cta_10_4_ttm,
    k.cta_12_7_ttm, k.cta_12_8_ttm
FROM universo u
LEFT JOIN (
    SELECT periodo, dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           SUM(COALESCE(cta_a4_1,0)+COALESCE(cta_a4_2,0)+COALESCE(cta_a4_3,0)) AS cartera_bruta,
           SUM(cta_c) AS patrimonio,
           SUM(cta_a) AS activos
    FROM marts.v_eeff_balance_ancho
    WHERE moneda='TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY 1, 2
) bg ON bg.periodo = u.periodo AND bg.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_oficinas_por_entidad_historica ofi
    ON ofi.periodo = u.periodo AND ofi.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_clientes_por_entidad_historica cli
    ON cli.periodo = u.periodo AND cli.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_personal_por_entidad_historica per
    ON per.periodo = u.periodo AND per.nomb_correg = u.nomb_correg
LEFT JOIN (
    SELECT periodo, nomb_correg, pct_participacion_smf AS pct_part_smf_coloc
    FROM marts.v_participacion_smf_coloc_historica
) smc ON smc.periodo = u.periodo AND smc.nomb_correg = u.nomb_correg
LEFT JOIN (
    SELECT periodo, nomb_correg, pct_participacion_smf AS pct_part_smf_dep
    FROM marts.v_participacion_smf_dep_historica
) smd ON smd.periodo = u.periodo AND smd.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_microfinancieras_historica mfi
    ON mfi.periodo = u.periodo AND mfi.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_mora_global_historica mora
    ON mora.periodo = u.periodo AND mora.nomb_correg = u.nomb_correg
LEFT JOIN marts.v_cobertura_car_historica cob
    ON cob.periodo = u.periodo AND cob.nomb_correg = u.nomb_correg
LEFT JOIN marts.mv_kpis_anuales_historica k
    ON k.periodo = u.periodo AND k.nomb_correg = u.nomb_correg
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_cuadro_resumen_historica_pk
    ON marts.mv_cuadro_resumen_historica (periodo, nomb_correg);
CREATE INDEX IF NOT EXISTS mv_cuadro_resumen_historica_periodo
    ON marts.mv_cuadro_resumen_historica (periodo);


-- ============ REFRESH FUNCTION ============
CREATE OR REPLACE FUNCTION marts.refresh_cuadro_resumen() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    t0 TIMESTAMPTZ := clock_timestamp();
    t_kpi TIMESTAMPTZ;
    t_can TIMESTAMPTZ;
    t_hist TIMESTAMPTZ;
BEGIN
    REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_entidad;
    REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_historica;
    t_kpi := clock_timestamp();

    REFRESH MATERIALIZED VIEW marts.mv_cuadro_resumen_canonico;
    t_can := clock_timestamp();

    REFRESH MATERIALIZED VIEW marts.mv_cuadro_resumen_historica;
    t_hist := clock_timestamp();

    RETURN format(
        'OK refresh total=%s kpis=%s canonico=%s historica=%s',
        t_hist - t0,
        t_kpi - t0,
        t_can - t_kpi,
        t_hist - t_can
    );
END $$;

COMMENT ON FUNCTION marts.refresh_cuadro_resumen() IS
    'Refresca KPIs anuales + cuadro_resumen canonico + historica. Toma 15-30 min. '
    'Llamar manualmente despues de imports masivos o via cron semanal.';
