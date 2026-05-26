-- =========================================================================
-- V076: MATERIALIZED VIEW unificada con TODOS los KPIs del cuadro resumen
-- por (periodo, nomb_correg). Una sola fila tiene todos los datos
-- necesarios para una columna del cuadro.
--
-- Antes: el cuadro resumen hacia un query gigante con 11 CTEs leyendo
-- cada vista individual. Tiempo total: ~8s.
-- Ahora: una sola lectura de mv_cuadro_resumen_* indexada por
-- (periodo, nomb_correg). Esperado: <100ms.
--
-- Refresh:
--   SELECT marts.refresh_cuadro_resumen();
-- Recomendado hacerlo despues de cada import masivo y semanalmente como
-- safeguard via cron.
-- =========================================================================

-- ============ CANONICA (consolidar=true) ============
DROP MATERIALIZED VIEW IF EXISTS marts.mv_cuadro_resumen_canonico CASCADE;

CREATE MATERIALIZED VIEW marts.mv_cuadro_resumen_canonico AS
WITH
-- Lista de (periodo, canonico) que aparecen en cualquier fuente
universo AS (
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
    -- Balance (cartera bruta = A4.1+A4.2+A4.3)
    bg.cartera_bruta,
    bg.patrimonio,
    bg.activos,
    -- Datos generales
    ofi.n_oficinas,
    cli.n_clientes,
    per.n_personal,
    per.n_empleados,
    -- SMF
    smc.pct_part_smf_coloc,
    smd.pct_part_smf_dep,
    mfi.pct_cartera_mype,
    -- Mora y Cobertura
    mora.pct_mora_global,
    mora.pct_mora_global_vc,
    cob.pct_cobertura_car,
    -- Anuales TTM (de mv_kpis_anuales_entidad)
    k.utilidad_ttm,
    k.patrimonio_prom_12m,
    k.activos_prom_12m,
    k.cta_1_ttm,
    k.cta_2_ttm,
    k.cta_6_ttm,
    k.cta_7_ttm,
    k.cta_10_1_ttm,
    k.cta_10_2_ttm,
    k.cta_10_3_ttm,
    k.cta_10_4_ttm,
    k.cta_12_7_ttm,
    k.cta_12_8_ttm
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
    ON k.periodo = u.periodo AND k.nomb_correg = u.nomb_correg;

CREATE UNIQUE INDEX IF NOT EXISTS mv_cuadro_resumen_canonico_pk
    ON marts.mv_cuadro_resumen_canonico (periodo, nomb_correg);
CREATE INDEX IF NOT EXISTS mv_cuadro_resumen_canonico_periodo
    ON marts.mv_cuadro_resumen_canonico (periodo);


-- ============ HISTORICA (consolidar=false) ============
DROP MATERIALIZED VIEW IF EXISTS marts.mv_cuadro_resumen_historica CASCADE;

CREATE MATERIALIZED VIEW marts.mv_cuadro_resumen_historica AS
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
    ON k.periodo = u.periodo AND k.nomb_correg = u.nomb_correg;

CREATE UNIQUE INDEX IF NOT EXISTS mv_cuadro_resumen_historica_pk
    ON marts.mv_cuadro_resumen_historica (periodo, nomb_correg);
CREATE INDEX IF NOT EXISTS mv_cuadro_resumen_historica_periodo
    ON marts.mv_cuadro_resumen_historica (periodo);


-- ============ FUNCION DE REFRESH ============
CREATE OR REPLACE FUNCTION marts.refresh_cuadro_resumen() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
    REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_entidad;
    REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_historica;
    REFRESH MATERIALIZED VIEW marts.mv_cuadro_resumen_canonico;
    REFRESH MATERIALIZED VIEW marts.mv_cuadro_resumen_historica;
    RETURN format('OK refresh en %s', clock_timestamp() - t0);
END $$;

COMMENT ON FUNCTION marts.refresh_cuadro_resumen() IS
    'Refresca todas las MVs del cuadro resumen. Llamar despues de imports nuevos.';
