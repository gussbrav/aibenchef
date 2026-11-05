-- =========================================================================
-- V206: Restaurar objetos faltantes tras auditoría post-V202 CASCADE
--
-- V202 hizo DROP MATERIALIZED VIEW marts.mv_eeff_resultados_ancho CASCADE.
-- V205 restauró la cadena de mora/venta-cartera (crítica para /informe).
-- Esta migración restaura los objetos secundarios que el CASCADE también
-- eliminó y que no estaban incluidos en V205:
--
--   1. marts.v_er4_mes_entidad        (canonizada, dependía de mv_eeff_resultados_ancho)
--   2. marts.v_a44_provisiones_entidad (canonizada, dependía de cadena anterior)
--   3. marts.v_dq_drift_kpis_sbs      (drift monitor, dependía de v_mora_global_por_entidad)
--   4. marts.mv_cuadro_resumen_canonico  (MV dropped; IF NOT EXISTS en V079 no la recrea)
--   5. marts.mv_cuadro_resumen_historica (idem)
--   6. idx_mv_eeff_balance_ancho_tipo   (índice perdido en V085, impacta queries por tipo_entidad)
--
-- Orden: de menos a más dependientes (cada objeto se crea después de sus deps).
--
-- Dependencias cumplidas al momento de esta migración:
--   - marts.mv_eeff_resultados_ancho  → existe (recreado en V202+)
--   - marts.v_mora_global_por_entidad → existe (recreado en V205)
--   - marts.v_indicadores_ancho       → existe
--   - marts.mv_eeff_balance_ancho     → existe
-- =========================================================================


-- =========================================================================
-- 1. v_er4_mes_entidad
--    ER4 (Ingresos/Egresos Extraordinarios) mensual, canonizado.
--    Usada por v_a44_provisiones_entidad (bloque 2) y como helper interno.
--    Depende de: marts.mv_eeff_resultados_ancho, dw.resolver_nomb_correg_canonico
-- =========================================================================
CREATE OR REPLACE VIEW marts.v_er4_mes_entidad AS
WITH ytd AS (
    SELECT e.periodo,
           dw.resolver_nomb_correg_canonico(e.nomb_correg) AS nomb_correg,
           SUM(e.cta_4) AS er4_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda = 'TOTAL' AND e.nomb_correg IS NOT NULL
    GROUP BY e.periodo, dw.resolver_nomb_correg_canonico(e.nomb_correg)
)
SELECT y.periodo, y.nomb_correg,
       CASE WHEN y.periodo % 100 = 1 THEN COALESCE(y.er4_ytd, 0)
            ELSE COALESCE(y.er4_ytd, 0) - COALESCE(yp.er4_ytd, 0)
       END AS er4_mes
FROM ytd y
LEFT JOIN ytd yp
       ON yp.nomb_correg = y.nomb_correg
      AND yp.periodo = y.periodo - 1
      AND y.periodo % 100 != 1;

COMMENT ON VIEW marts.v_er4_mes_entidad IS
    'ER4 mensual canonizado (cta_4 YTD minus YTD mes anterior). '
    'Restaurada en V206 tras drop en cascada de V202.';


-- =========================================================================
-- 2. v_a44_provisiones_entidad
--    Provisiones de cartera (cta_a4_4) del balance, canonizado.
--    Depende de: marts.v_eeff_balance_ancho, dw.resolver_nomb_correg_canonico
-- =========================================================================
CREATE OR REPLACE VIEW marts.v_a44_provisiones_entidad AS
SELECT
    b.periodo,
    dw.resolver_nomb_correg_canonico(b.nomb_correg) AS nomb_correg,
    SUM(b.cta_a4_4) AS a44
FROM marts.v_eeff_balance_ancho b
WHERE b.moneda = 'TOTAL' AND b.nomb_correg IS NOT NULL
GROUP BY b.periodo, dw.resolver_nomb_correg_canonico(b.nomb_correg);

COMMENT ON VIEW marts.v_a44_provisiones_entidad IS
    'Provisiones de cartera (cta_a4_4) canonizadas por entidad y periodo. '
    'Restaurada en V206 tras drop en cascada de V202.';


-- =========================================================================
-- 3. v_dq_drift_kpis_sbs
--    Monitoreo de drift entre KPIs Aibenchef y SBS oficial.
--    Depende de: marts.v_indicadores_ancho, marts.v_mora_global_por_entidad
--    Nota: v_mora_global_por_entidad fue restaurada en V205.
-- =========================================================================
CREATE OR REPLACE VIEW marts.v_dq_drift_kpis_sbs AS
WITH ratios_sbs AS (
    SELECT periodo, nomb_correg,
           mora_atrasados_sobre_directos AS mora_sbs_pct
    FROM marts.v_indicadores_ancho
    WHERE mora_atrasados_sobre_directos IS NOT NULL
),
ratios_aibenchef AS (
    SELECT periodo, nomb_correg,
           CASE WHEN cartera_bruta > 0
                THEN ROUND((cartera_atrasada / cartera_bruta * 100)::numeric, 4)
                ELSE NULL
           END AS mora_aibenchef_pct
    FROM marts.v_mora_global_por_entidad
    WHERE cartera_bruta > 0
)
SELECT
    s.periodo,
    s.nomb_correg,
    'mora_atrasados_sobre_directos'           AS kpi,
    s.mora_sbs_pct                            AS valor_sbs,
    a.mora_aibenchef_pct                      AS valor_aibenchef,
    (a.mora_aibenchef_pct - s.mora_sbs_pct)   AS drift_pp,
    ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) AS drift_abs_pp,
    CASE
        WHEN a.mora_aibenchef_pct IS NULL                         THEN 'sin_calculo_aibenchef'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.10   THEN 'ok'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 0.50   THEN 'info'
        WHEN ABS(a.mora_aibenchef_pct - s.mora_sbs_pct) < 2.00   THEN 'warning'
        ELSE 'critical'
    END AS severity
FROM ratios_sbs s
LEFT JOIN ratios_aibenchef a
    ON a.periodo = s.periodo AND a.nomb_correg = s.nomb_correg;

COMMENT ON VIEW marts.v_dq_drift_kpis_sbs IS
    'Drift monitoring: mora Aibenchef vs SBS oficial (mora_atrasados_sobre_directos). '
    'Restaurada en V206 (antes en V187); depende de v_mora_global_por_entidad '
    'que fue restaurada en V205. Usar en /admin/data-quality.';


-- =========================================================================
-- 4 + 5. mv_cuadro_resumen_canonico y mv_cuadro_resumen_historica
--
--    MVs de cuadro resumen. V079 las creó con IF NOT EXISTS, por lo que
--    si fueron bajadas por algún CASCADE anterior, IF NOT EXISTS no las
--    recrea. Aquí usamos DROP + CREATE para forzar la restauración.
--
--    Se crean WITH NO DATA (igual que V079) para evitar timeout del
--    migrator. Poblar después con:
--        SELECT marts.refresh_cuadro_resumen();  -- tarda 15-30 min
--
--    La función refresh_cuadro_resumen() ya existe en producción (V079).
-- =========================================================================
DROP MATERIALIZED VIEW IF EXISTS marts.mv_cuadro_resumen_canonico CASCADE;
CREATE MATERIALIZED VIEW marts.mv_cuadro_resumen_canonico AS
WITH universo AS (
    SELECT DISTINCT periodo,
           dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
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
    SELECT periodo,
           dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           SUM(COALESCE(cta_a4_1,0)+COALESCE(cta_a4_2,0)+COALESCE(cta_a4_3,0)) AS cartera_bruta,
           SUM(cta_c) AS patrimonio,
           SUM(cta_a) AS activos
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY 1, 2
) bg  ON bg.periodo  = u.periodo AND bg.nomb_correg  = u.nomb_correg
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

CREATE UNIQUE INDEX mv_cuadro_resumen_canonico_pk
    ON marts.mv_cuadro_resumen_canonico (periodo, nomb_correg);
CREATE INDEX mv_cuadro_resumen_canonico_periodo
    ON marts.mv_cuadro_resumen_canonico (periodo);

COMMENT ON MATERIALIZED VIEW marts.mv_cuadro_resumen_canonico IS
    'KPIs consolidados por entidad canónica y periodo. WITH NO DATA — '
    'poblar con SELECT marts.refresh_cuadro_resumen() (15-30 min). '
    'Restaurada en V206 tras drop en cascada de V202.';


DROP MATERIALIZED VIEW IF EXISTS marts.mv_cuadro_resumen_historica CASCADE;
CREATE MATERIALIZED VIEW marts.mv_cuadro_resumen_historica AS
WITH universo AS (
    SELECT DISTINCT periodo,
           dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
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
    SELECT periodo,
           dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           SUM(COALESCE(cta_a4_1,0)+COALESCE(cta_a4_2,0)+COALESCE(cta_a4_3,0)) AS cartera_bruta,
           SUM(cta_c) AS patrimonio,
           SUM(cta_a) AS activos
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY 1, 2
) bg  ON bg.periodo  = u.periodo AND bg.nomb_correg  = u.nomb_correg
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

CREATE UNIQUE INDEX mv_cuadro_resumen_historica_pk
    ON marts.mv_cuadro_resumen_historica (periodo, nomb_correg);
CREATE INDEX mv_cuadro_resumen_historica_periodo
    ON marts.mv_cuadro_resumen_historica (periodo);

COMMENT ON MATERIALIZED VIEW marts.mv_cuadro_resumen_historica IS
    'KPIs por entidad nombre-histórico y periodo. WITH NO DATA — '
    'poblar con SELECT marts.refresh_cuadro_resumen() (15-30 min). '
    'Restaurada en V206 tras drop en cascada de V202.';


-- =========================================================================
-- 6. Índice idx_mv_eeff_balance_ancho_tipo
--    Perdido cuando V085 recreó mv_eeff_balance_ancho sin incluirlo.
--    Mejora performance en queries que filtran por tipo_entidad
--    (ej: getCuadroResumenRaw filtra por BANCOS, CMAC, etc.).
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_mv_eeff_balance_ancho_tipo
    ON marts.mv_eeff_balance_ancho (tipo_entidad);

COMMENT ON INDEX marts.idx_mv_eeff_balance_ancho_tipo IS
    'Índice sobre tipo_entidad en mv_eeff_balance_ancho. '
    'Restaurado en V206 (perdido en V085 que recreó la MV sin él).';
