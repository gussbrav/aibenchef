-- =========================================================================
-- V011: Vista materializada de ratios canonicos EEFF
--
-- Replica los 11 CalculatedMember del cubo Mondrian legacy de Gus
-- (D:\PROYECTO\SBS\Analisis\SBS\EEFF\DW_SBS_BG.xml + DW_SBS_ER.xml):
--   Balance:    %Cob_ATRAS, %Cob_CAR, %Mora, CarteraBruta, DepositosSBS,
--               TotalFondeo, TotalFondeo/CarteraBruta, Ahorros/FondeoTotal
--   Resultados: GastoFondeo, IngresosTotales, GastosAdmin/IngresosTotales
--
-- Mas: ROA, ROE (estandar SBS).
--
-- Una fila por (periodo, nomb_correg, moneda). JOIN entre marts.mv_eeff_balance_ancho
-- y marts.mv_eeff_resultados_ancho.
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_ratios;

CREATE MATERIALIZED VIEW marts.mv_eeff_ratios AS
SELECT
    bg.periodo,
    bg.fecha_cierre,
    bg.nomb_correg,
    bg.empresa_sbs,
    bg.tipo_entidad,
    bg.microfinanciera,
    bg.nacional,
    bg.moneda,

    -- ============================================================
    -- Valores base
    -- ============================================================
    bg.cta_a   AS total_activo,
    bg.cta_b   AS total_pasivo,
    bg.cta_c   AS patrimonio,
    er.cta_17  AS utilidad_neta,

    -- ============================================================
    -- Balance — calculated members del cubo Mondrian de Gus
    -- ============================================================

    -- CarteraBruta = A4.1 (Vigentes) + A4.2 (Refinanciados) + A4.3 (Atrasados)
    (COALESCE(bg.cta_a4_1, 0) + COALESCE(bg.cta_a4_2, 0) + COALESCE(bg.cta_a4_3, 0))
        AS cartera_bruta,

    -- %Mora = A4.3 / (A4.1 + A4.2 + A4.3)
    CASE
        WHEN (COALESCE(bg.cta_a4_1, 0) + COALESCE(bg.cta_a4_2, 0) + COALESCE(bg.cta_a4_3, 0)) = 0
        THEN NULL
        ELSE COALESCE(bg.cta_a4_3, 0) /
             NULLIF(COALESCE(bg.cta_a4_1, 0) + COALESCE(bg.cta_a4_2, 0) + COALESCE(bg.cta_a4_3, 0), 0)
    END AS ratio_mora,

    -- %Cob_ATRAS = A4.4 / A4.3 * -1 (A4.4 es negativo en SBS, por eso * -1)
    CASE
        WHEN COALESCE(bg.cta_a4_3, 0) = 0 THEN NULL
        ELSE COALESCE(bg.cta_a4_4, 0) / NULLIF(bg.cta_a4_3, 0) * -1
    END AS ratio_cobertura_atrasados,

    -- %Cob_CAR = A4.4 / (A4.3 + A4.2) * -1 (cobertura cartera alto riesgo)
    CASE
        WHEN (COALESCE(bg.cta_a4_3, 0) + COALESCE(bg.cta_a4_2, 0)) = 0 THEN NULL
        ELSE COALESCE(bg.cta_a4_4, 0)
             / NULLIF(COALESCE(bg.cta_a4_3, 0) + COALESCE(bg.cta_a4_2, 0), 0) * -1
    END AS ratio_cobertura_car,

    -- DepositosSBS = B1.1 + B1.2 + B1.3 + B1.4 + B2
    (COALESCE(bg.cta_b1_1, 0) + COALESCE(bg.cta_b1_2, 0) + COALESCE(bg.cta_b1_3, 0)
        + COALESCE(bg.cta_b1_4, 0) + COALESCE(bg.cta_b2, 0))
        AS depositos_sbs,

    -- TotalFondeo = B1 + B2 + B3 + B4 + B5 + B10
    (COALESCE(bg.cta_b1, 0) + COALESCE(bg.cta_b2, 0) + COALESCE(bg.cta_b3, 0)
        + COALESCE(bg.cta_b4, 0) + COALESCE(bg.cta_b5, 0) + COALESCE(bg.cta_b10, 0))
        AS total_fondeo,

    -- Ahorros/FondeoTotal = B1.2 / TotalFondeo
    CASE
        WHEN (COALESCE(bg.cta_b1, 0) + COALESCE(bg.cta_b2, 0) + COALESCE(bg.cta_b3, 0)
             + COALESCE(bg.cta_b4, 0) + COALESCE(bg.cta_b5, 0) + COALESCE(bg.cta_b10, 0)) = 0
        THEN NULL
        ELSE COALESCE(bg.cta_b1_2, 0) /
             NULLIF(COALESCE(bg.cta_b1, 0) + COALESCE(bg.cta_b2, 0) + COALESCE(bg.cta_b3, 0)
                  + COALESCE(bg.cta_b4, 0) + COALESCE(bg.cta_b5, 0) + COALESCE(bg.cta_b10, 0), 0)
    END AS ratio_ahorros_sobre_fondeo,

    -- ============================================================
    -- Resultados — calculated members
    -- ============================================================

    -- GastoFondeo = ER 2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6
    (COALESCE(er.cta_2_1, 0) + COALESCE(er.cta_2_2, 0) + COALESCE(er.cta_2_3, 0)
        + COALESCE(er.cta_2_4, 0) + COALESCE(er.cta_2_5, 0) + COALESCE(er.cta_2_6, 0))
        AS gasto_fondeo,

    -- IngresosTotales = ER_1 + ER_6 + ER_8 + ER_13 - ER_2.7 - ER_2.8 - ER_2.10 - ER_2.11
    (COALESCE(er.cta_1, 0) + COALESCE(er.cta_6, 0) + COALESCE(er.cta_8, 0)
        + COALESCE(er.cta_13, 0)
        - COALESCE(er.cta_2_7, 0) - COALESCE(er.cta_2_8, 0)
        - COALESCE(er.cta_2_10, 0) - COALESCE(er.cta_2_11, 0))
        AS ingresos_totales,

    -- GastosAdmin/IngresosTotales (ratio de eficiencia)
    CASE
        WHEN (COALESCE(er.cta_1, 0) + COALESCE(er.cta_6, 0) + COALESCE(er.cta_8, 0)
             + COALESCE(er.cta_13, 0)
             - COALESCE(er.cta_2_7, 0) - COALESCE(er.cta_2_8, 0)
             - COALESCE(er.cta_2_10, 0) - COALESCE(er.cta_2_11, 0)) = 0
        THEN NULL
        ELSE COALESCE(er.cta_10, 0) /
             NULLIF(COALESCE(er.cta_1, 0) + COALESCE(er.cta_6, 0) + COALESCE(er.cta_8, 0)
                  + COALESCE(er.cta_13, 0)
                  - COALESCE(er.cta_2_7, 0) - COALESCE(er.cta_2_8, 0)
                  - COALESCE(er.cta_2_10, 0) - COALESCE(er.cta_2_11, 0), 0)
    END AS ratio_eficiencia,

    -- ============================================================
    -- Rentabilidad (no estaban en el cubo Mondrian pero son estandar SBS)
    -- ============================================================

    -- ROA = Utilidad Neta / Total Activo
    CASE
        WHEN COALESCE(bg.cta_a, 0) = 0 THEN NULL
        ELSE COALESCE(er.cta_17, 0) / NULLIF(bg.cta_a, 0)
    END AS roa,

    -- ROE = Utilidad Neta / Patrimonio
    CASE
        WHEN COALESCE(bg.cta_c, 0) = 0 THEN NULL
        ELSE COALESCE(er.cta_17, 0) / NULLIF(bg.cta_c, 0)
    END AS roe,

    -- Apalancamiento = Pasivo / Patrimonio
    CASE
        WHEN COALESCE(bg.cta_c, 0) = 0 THEN NULL
        ELSE COALESCE(bg.cta_b, 0) / NULLIF(bg.cta_c, 0)
    END AS apalancamiento

FROM marts.mv_eeff_balance_ancho AS bg
LEFT JOIN marts.mv_eeff_resultados_ancho AS er
    ON er.periodo = bg.periodo
   AND er.nomb_correg = bg.nomb_correg
   AND er.moneda = bg.moneda;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_eeff_ratios
    ON marts.mv_eeff_ratios (periodo, nomb_correg, moneda);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_ratios_periodo
    ON marts.mv_eeff_ratios (periodo);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_ratios_entidad
    ON marts.mv_eeff_ratios (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_ratios_tipo
    ON marts.mv_eeff_ratios (tipo_entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_eeff_ratios IS
    'Ratios canonicos EEFF replicando los CalculatedMember del cubo Mondrian '
    'legacy de Gus. Mora, cobertura, fondeo, ROE, ROA, eficiencia. Refresh tras '
    'cada nueva carga mensual de raw.eeff_observacion.';
