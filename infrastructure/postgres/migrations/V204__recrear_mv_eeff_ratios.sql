-- =========================================================================
-- V204: Restaurar marts.mv_eeff_ratios perdida por CASCADE de V202
--
-- V202 hizo DROP MATERIALIZED VIEW marts.mv_eeff_resultados_ancho CASCADE.
-- Ese CASCADE eliminó automáticamente marts.mv_eeff_ratios (que depende
-- de mv_eeff_resultados_ancho). V202 recreó mv_eeff_resultados_ancho pero
-- olvidó recrear mv_eeff_ratios — lo que crashea /dashboard y /dashboard/eeff.
--
-- Esta migración replica exactamente la definición de V012 (última versión
-- vigente) y popula la MV con REFRESH.
--
-- LECCIÓN APRENDIDA: Al hacer DROP ... CASCADE sobre una MV, siempre
-- verificar qué objetos dependientes se bajaron (pg_depend) y recrearlos
-- en la misma migración. Usar:
--   SELECT dependent_ns.nspname||'.'||dependent.relname AS bajado
--   FROM pg_depend d
--   JOIN pg_class dependent ON dependent.oid = d.objid
--   JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
--   JOIN pg_class source ON source.oid = d.refobjid
--   WHERE source.relname = 'mv_eeff_resultados_ancho'
--     AND d.deptype = 'n';
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_ratios;

CREATE MATERIALIZED VIEW marts.mv_eeff_ratios AS
WITH base AS (
    SELECT
        bg.periodo,
        bg.fecha_cierre,
        bg.nomb_correg,
        bg.empresa_sbs,
        bg.tipo_entidad,
        bg.microfinanciera,
        bg.nacional,
        bg.moneda,

        (COALESCE(bg.cta_a1, 0) + COALESCE(bg.cta_a2, 0) + COALESCE(bg.cta_a3, 0)
            + COALESCE(bg.cta_a4, 0) + COALESCE(bg.cta_a5, 0) + COALESCE(bg.cta_a6, 0)
            + COALESCE(bg.cta_a7, 0) + COALESCE(bg.cta_a8, 0) + COALESCE(bg.cta_a9, 0))
            AS total_activo,

        (COALESCE(bg.cta_b1, 0) + COALESCE(bg.cta_b2, 0) + COALESCE(bg.cta_b3, 0)
            + COALESCE(bg.cta_b4, 0) + COALESCE(bg.cta_b5, 0) + COALESCE(bg.cta_b6, 0)
            + COALESCE(bg.cta_b7, 0) + COALESCE(bg.cta_b8, 0) + COALESCE(bg.cta_b9, 0)
            + COALESCE(bg.cta_b10, 0))
            AS total_pasivo,

        (COALESCE(bg.cta_c1, 0) + COALESCE(bg.cta_c2, 0) + COALESCE(bg.cta_c3, 0)
            + COALESCE(bg.cta_c4, 0) + COALESCE(bg.cta_c5, 0) + COALESCE(bg.cta_c6, 0)
            + COALESCE(bg.cta_c7, 0) + COALESCE(bg.cta_c8, 0))
            AS patrimonio,

        er.cta_17 AS utilidad_neta,

        bg.cta_a4_1, bg.cta_a4_2, bg.cta_a4_3, bg.cta_a4_4,
        bg.cta_b1, bg.cta_b1_1, bg.cta_b1_2, bg.cta_b1_3, bg.cta_b1_4,
        bg.cta_b2, bg.cta_b3, bg.cta_b4, bg.cta_b5, bg.cta_b10,
        er.cta_1, er.cta_6, er.cta_8, er.cta_10, er.cta_13,
        er.cta_2_1, er.cta_2_2, er.cta_2_3, er.cta_2_4, er.cta_2_5,
        er.cta_2_6, er.cta_2_7, er.cta_2_8, er.cta_2_10, er.cta_2_11
    FROM marts.mv_eeff_balance_ancho AS bg
    LEFT JOIN marts.mv_eeff_resultados_ancho AS er
        ON er.periodo    = bg.periodo
       AND er.nomb_correg = bg.nomb_correg
       AND er.moneda      = bg.moneda
)
SELECT
    periodo,
    fecha_cierre,
    nomb_correg,
    empresa_sbs,
    tipo_entidad,
    microfinanciera,
    nacional,
    moneda,

    total_activo,
    total_pasivo,
    patrimonio,
    utilidad_neta,

    (COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0))
        AS cartera_bruta,

    CASE
        WHEN (COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0)) = 0
        THEN NULL
        ELSE COALESCE(cta_a4_3, 0) /
             NULLIF(COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0), 0)
    END AS ratio_mora,

    CASE
        WHEN COALESCE(cta_a4_3, 0) = 0 THEN NULL
        ELSE COALESCE(cta_a4_4, 0) / NULLIF(cta_a4_3, 0) * -1
    END AS ratio_cobertura_atrasados,

    CASE
        WHEN (COALESCE(cta_a4_3, 0) + COALESCE(cta_a4_2, 0)) = 0 THEN NULL
        ELSE COALESCE(cta_a4_4, 0)
             / NULLIF(COALESCE(cta_a4_3, 0) + COALESCE(cta_a4_2, 0), 0) * -1
    END AS ratio_cobertura_car,

    (COALESCE(cta_b1_1, 0) + COALESCE(cta_b1_2, 0) + COALESCE(cta_b1_3, 0)
        + COALESCE(cta_b1_4, 0) + COALESCE(cta_b2, 0))
        AS depositos_sbs,

    (COALESCE(cta_b1, 0) + COALESCE(cta_b2, 0) + COALESCE(cta_b3, 0)
        + COALESCE(cta_b4, 0) + COALESCE(cta_b5, 0) + COALESCE(cta_b10, 0))
        AS total_fondeo,

    CASE
        WHEN (COALESCE(cta_b1, 0) + COALESCE(cta_b2, 0) + COALESCE(cta_b3, 0)
             + COALESCE(cta_b4, 0) + COALESCE(cta_b5, 0) + COALESCE(cta_b10, 0)) = 0
        THEN NULL
        ELSE COALESCE(cta_b1_2, 0) /
             NULLIF(COALESCE(cta_b1, 0) + COALESCE(cta_b2, 0) + COALESCE(cta_b3, 0)
                  + COALESCE(cta_b4, 0) + COALESCE(cta_b5, 0) + COALESCE(cta_b10, 0), 0)
    END AS ratio_ahorros_sobre_fondeo,

    (COALESCE(cta_2_1, 0) + COALESCE(cta_2_2, 0) + COALESCE(cta_2_3, 0)
        + COALESCE(cta_2_4, 0) + COALESCE(cta_2_5, 0) + COALESCE(cta_2_6, 0))
        AS gasto_fondeo,

    (COALESCE(cta_1, 0) + COALESCE(cta_6, 0) + COALESCE(cta_8, 0)
        + COALESCE(cta_13, 0)
        - COALESCE(cta_2_7, 0) - COALESCE(cta_2_8, 0)
        - COALESCE(cta_2_10, 0) - COALESCE(cta_2_11, 0))
        AS ingresos_totales,

    CASE
        WHEN (COALESCE(cta_1, 0) + COALESCE(cta_6, 0) + COALESCE(cta_8, 0)
             + COALESCE(cta_13, 0)
             - COALESCE(cta_2_7, 0) - COALESCE(cta_2_8, 0)
             - COALESCE(cta_2_10, 0) - COALESCE(cta_2_11, 0)) = 0
        THEN NULL
        ELSE COALESCE(cta_10, 0) /
             NULLIF(COALESCE(cta_1, 0) + COALESCE(cta_6, 0) + COALESCE(cta_8, 0)
                  + COALESCE(cta_13, 0)
                  - COALESCE(cta_2_7, 0) - COALESCE(cta_2_8, 0)
                  - COALESCE(cta_2_10, 0) - COALESCE(cta_2_11, 0), 0)
    END AS ratio_eficiencia,

    CASE
        WHEN total_activo = 0 THEN NULL
        ELSE COALESCE(utilidad_neta, 0) / NULLIF(total_activo, 0)
    END AS roa,

    CASE
        WHEN patrimonio = 0 THEN NULL
        ELSE COALESCE(utilidad_neta, 0) / NULLIF(patrimonio, 0)
    END AS roe,

    CASE
        WHEN patrimonio = 0 THEN NULL
        ELSE total_pasivo / NULLIF(patrimonio, 0)
    END AS apalancamiento

FROM base;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_eeff_ratios
    ON marts.mv_eeff_ratios (periodo, nomb_correg, moneda);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_ratios_periodo
    ON marts.mv_eeff_ratios (periodo);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_ratios_entidad
    ON marts.mv_eeff_ratios (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_ratios_tipo
    ON marts.mv_eeff_ratios (tipo_entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_eeff_ratios IS
    'Ratios canonicos EEFF. V204: restaurada tras CASCADE de V202. '
    'V012: fix de totales sumando hijos directos '
    '(A1..A9 = total_activo, B1..B10 = total_pasivo, C1..C8 = patrimonio). '
    'Refresh tras cada nueva carga mensual de raw.eeff_observacion.';
