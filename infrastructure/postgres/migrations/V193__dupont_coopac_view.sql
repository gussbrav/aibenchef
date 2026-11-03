-- =========================================================================
-- V193: analytics.v_dupont_coopac — DuPont decomposition para cooperativas
--
-- Vista materializable con los 3 factores DuPont + métricas extendidas
-- para todos los niveles COOPAC.
--
-- DuPont 3-factor (identidad verificada):
--   ROE = Margen Neto × Rotación de Activos × Apalancamiento
--       = (RN/IF) × (IF/A) × (A/C)
--
-- Eficiencia GA (10/1) puede ser NULL para N3 periodos 202605 y 202608
-- porque SBS publicó esos archivos sin la fila agregada GASTOS ADMIN.
-- Usar COALESCE(eficiencia_ga_pct, 0) solo en displays — no imputar.
--
-- Cartera Bruta = A4.1 + A4.2 + A4.3 + A4.4 (vigentes+refinanciados+atrasados)
-- Morosos = A4.3 + A4.4 (vencidos + en cobranza judicial)
-- Provisiones BG (A4.6) se almacenan como negativo — usar ABS para cobertura.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS analytics.v_dupont_coopac;
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS analytics;

DROP VIEW IF EXISTS analytics.v_dupont_coopac;

CREATE VIEW analytics.v_dupont_coopac AS
WITH gyp AS (
    SELECT
        periodo,
        nomb_correg,
        tipo_entidad,
        moneda,
        MAX(CASE WHEN cuenta_codigo = '1'   THEN valor END) AS if_,
        MAX(CASE WHEN cuenta_codigo = '2'   THEN valor END) AS gf,
        MAX(CASE WHEN cuenta_codigo = '4'   THEN valor END) AS prov_gyp,
        MAX(CASE WHEN cuenta_codigo = '10'  THEN valor END) AS ga,
        MAX(CASE WHEN cuenta_codigo = '12'  THEN valor END) AS dep_amort,
        MAX(CASE WHEN cuenta_codigo = '13'  THEN valor END) AS otros,
        MAX(CASE WHEN cuenta_codigo = '17'  THEN valor END) AS rn
    FROM raw.eeff_observacion
    WHERE tipo_entidad LIKE 'COOPAC_%'
      AND tipo_estado = 'resultados'
    GROUP BY periodo, nomb_correg, tipo_entidad, moneda
),
bg AS (
    SELECT
        periodo,
        nomb_correg,
        tipo_entidad,
        moneda,
        MAX(CASE WHEN cuenta_codigo = 'A'    THEN valor END) AS activo,
        MAX(CASE WHEN cuenta_codigo = 'B'    THEN valor END) AS pasivo,
        MAX(CASE WHEN cuenta_codigo = 'C'    THEN valor END) AS patrimonio,
        MAX(CASE WHEN cuenta_codigo = 'A4.1' THEN valor END) AS vigentes,
        MAX(CASE WHEN cuenta_codigo = 'A4.2' THEN valor END) AS refinanciados,
        MAX(CASE WHEN cuenta_codigo = 'A4.3' THEN valor END) AS vencidos,
        MAX(CASE WHEN cuenta_codigo = 'A4.4' THEN valor END) AS en_cobranza,
        ABS(MAX(CASE WHEN cuenta_codigo = 'A4.6' THEN valor END)) AS prov_bg,
        MAX(CASE WHEN cuenta_codigo = 'B1'   THEN valor END) AS depositos_socios
    FROM raw.eeff_observacion
    WHERE tipo_entidad LIKE 'COOPAC_%'
      AND tipo_estado = 'balance'
    GROUP BY periodo, nomb_correg, tipo_entidad, moneda
)
SELECT
    g.periodo,
    g.nomb_correg,
    g.tipo_entidad,
    g.moneda,

    -- -----------------------------------------------------------------------
    -- DuPont 3-factor
    -- Identidad: roe_pct ≈ margen_neto_pct * rotacion_activos_pct/100 * apalancamiento
    -- -----------------------------------------------------------------------
    ROUND(g.rn    / NULLIF(g.if_, 0)    * 100, 2) AS margen_neto_pct,
    ROUND(g.if_   / NULLIF(b.activo, 0) * 100, 2) AS rotacion_activos_pct,
    ROUND(b.activo / NULLIF(b.patrimonio, 0),   2) AS apalancamiento,
    ROUND(g.rn    / NULLIF(b.patrimonio, 0) * 100, 2) AS roe_pct,
    ROUND(g.rn    / NULLIF(b.activo, 0)     * 100, 2) AS roa_pct,

    -- -----------------------------------------------------------------------
    -- DuPont extendido: waterfall de márgenes (componentes del margen neto)
    -- Suma: gf_sobre_if + prov_sobre_if + ga_sobre_if + dep_sobre_if + otros_sobre_if + margen_neto ≈ 100
    -- -----------------------------------------------------------------------
    ROUND(g.gf       / NULLIF(g.if_, 0) * 100, 2) AS gf_sobre_if_pct,
    ROUND(g.prov_gyp / NULLIF(g.if_, 0) * 100, 2) AS prov_sobre_if_pct,
    ROUND(g.ga       / NULLIF(g.if_, 0) * 100, 2) AS ga_sobre_if_pct,
    ROUND(g.dep_amort / NULLIF(g.if_, 0) * 100, 2) AS dep_sobre_if_pct,
    ROUND(g.otros    / NULLIF(g.if_, 0) * 100, 2) AS otros_sobre_if_pct,

    -- -----------------------------------------------------------------------
    -- Calidad de cartera
    -- -----------------------------------------------------------------------
    ROUND(
        (b.vigentes + b.refinanciados + b.vencidos + b.en_cobranza), 2
    ) AS cartera_bruta,
    ROUND(
        (b.vencidos + b.en_cobranza) /
        NULLIF(b.vigentes + b.refinanciados + b.vencidos + b.en_cobranza, 0) * 100, 2
    ) AS mora_pct,
    ROUND(
        b.prov_bg /
        NULLIF(b.vencidos + b.en_cobranza, 0) * 100, 2
    ) AS cobertura_car_pct,

    -- -----------------------------------------------------------------------
    -- Rendimiento y eficiencia
    -- -----------------------------------------------------------------------
    ROUND(
        g.if_ /
        NULLIF(b.vigentes + b.refinanciados + b.vencidos + b.en_cobranza, 0) * 100, 2
    ) AS yield_cartera_pct,
    ROUND(b.depositos_socios / NULLIF(b.activo, 0) * 100, 2) AS depositos_sobre_activo_pct,

    -- -----------------------------------------------------------------------
    -- Montos base (en unidades originales del archivo SBS)
    -- -----------------------------------------------------------------------
    b.activo,
    b.patrimonio,
    g.if_,
    g.rn,
    g.ga

FROM gyp g
JOIN bg b USING (periodo, nomb_correg, tipo_entidad, moneda)
WHERE g.if_ IS NOT NULL
  AND b.activo IS NOT NULL
  AND b.patrimonio IS NOT NULL;

COMMENT ON VIEW analytics.v_dupont_coopac IS
    'DuPont decomposition para cooperativas COOPAC. '
    'ga_sobre_if_pct puede ser NULL para N3 periodos 202605/202608 (gap en datos SBS). '
    'Usar COALESCE(ga_sobre_if_pct, 0) solo en display — no imputar en análisis. '
    'Unidades monetarias: miles de soles (misma escala que raw.eeff_observacion).';
