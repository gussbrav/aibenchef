-- =========================================================================
-- V203: Alinea semántica A4.x COOPAC con SF (Atrasados = subtotal)
--
-- Antes (V201/V202): A4.3=Vencidos, A4.4=CobranzaJud, A4.6=Provisiones,
--                    A4.7=Intereses
-- Ahora: A4.3=Atrasados(subtotal), A4.3.1=Vencidos, A4.3.2=CobranzaJud,
--        A4.4=Provisiones, A4.5=Intereses — idéntico a SF
--
-- La MV (V009) ya tenía cta_a4_3 (Atrasados), cta_a4_3_1 (Vencidos),
-- cta_a4_3_2 (CobranzaJud), cta_a4_4 (Provisiones), cta_a4_5 (Intereses).
-- Solo faltaba que importer/DB enviaran los códigos correctos.
--
-- FÓRMULA: Cartera Bruta = A4.1 + A4.2 + A4.3 — uniforme para SF y COOPAC.
-- Los ratios (V011/V012) usan cta_a4_3 / (cta_a4_1+cta_a4_2+cta_a4_3)
-- que ahora funciona igual para ambos tipos de entidad.
--
-- KPIs (V199): usa GREATEST(cta_a4_4, 0) que da 0 para Provisiones<0;
-- resultado numérico de cartera_prom es idéntico, no se re-ejecuta V199.
--
-- IDEMPOTENTE: UPDATEs filtran por código actual; INSERTs usan
--   ON CONFLICT / WHERE NOT EXISTS.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. cabecera_maestra: renombrar códigos COOPAC en A4.x
-- -------------------------------------------------------------------------

-- 1a. Vencidos: A4.3 → A4.3.1
UPDATE dw.cabecera_maestra
SET codigo = 'A4.3.1'
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND codigo        = 'A4.3'
  AND valido_hasta IS NULL;

-- 1b. En Cobranza Judicial: A4.4 → A4.3.2
UPDATE dw.cabecera_maestra
SET codigo = 'A4.3.2'
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND codigo        = 'A4.4'
  AND valido_hasta IS NULL;

-- 1c. Provisiones: A4.6 → A4.4
UPDATE dw.cabecera_maestra
SET codigo = 'A4.4'
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND codigo        = 'A4.6'
  AND valido_hasta IS NULL;

-- 1d. Intereses y Comisiones no Devengados: A4.7 → A4.5
UPDATE dw.cabecera_maestra
SET codigo = 'A4.5'
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND codigo        = 'A4.7'
  AND valido_hasta IS NULL;

-- 1e. Insertar Atrasados (subtotal) como A4.3 para los 4 niveles COOPAC.
-- parent_codigo='A4': el importer busca (current_l2_code="A4", nombre_norm)
-- para todas las filas mixed-case bajo Créditos Netos (incluye Atrasados,
-- Vencidos y CobranzaJud — el Excel no usa ALL CAPS para ninguna de ellas).
-- valido_desde=CURRENT_DATE evita conflicto con otros rows del mismo orden.
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, codigo, nombre, nivel, parent_codigo,
     pais, regulador, orden, valido_desde)
SELECT
    'balance',
    g.tipo_entidad,
    'A4.3',
    'ATRASADOS',
    3,
    'A4',
    'PE',
    'SBS',
    (SELECT MIN(cm2.orden)
     FROM dw.cabecera_maestra cm2
     WHERE cm2.tipo_entidad  = g.tipo_entidad
       AND cm2.tipo_estado   = 'balance'
       AND cm2.codigo        = 'A4.3.1'
       AND cm2.valido_hasta IS NULL) - 1,
    (EXTRACT(YEAR FROM NOW())::INT * 100 + EXTRACT(MONTH FROM NOW())::INT)
FROM (VALUES
    ('COOPAC_N3'::TEXT),
    ('COOPAC_N2B'),
    ('COOPAC_N2A'),
    ('COOPAC_N1')
) AS g(tipo_entidad)
WHERE NOT EXISTS (
    SELECT 1 FROM dw.cabecera_maestra cm
    WHERE cm.tipo_entidad  = g.tipo_entidad
      AND cm.tipo_estado   = 'balance'
      AND cm.codigo        = 'A4.3'
      AND cm.valido_hasta IS NULL
);

-- -------------------------------------------------------------------------
-- 2. raw.eeff_observacion: corregir histórico COOPAC
-- Orden importa: primero renombrar A4.3→A4.3.1 y A4.4→A4.3.2 antes de
-- insertar A4.3 (Atrasados), para que el INSERT los encuentre en A4.3.1/2.
-- -------------------------------------------------------------------------

-- 2a. Vencidos: A4.3 → A4.3.1
UPDATE raw.eeff_observacion
SET cuenta_codigo = 'A4.3.1'
WHERE tipo_entidad  LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND cuenta_codigo = 'A4.3';

-- 2b. En Cobranza Judicial: A4.4 → A4.3.2
UPDATE raw.eeff_observacion
SET cuenta_codigo = 'A4.3.2'
WHERE tipo_entidad  LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND cuenta_codigo = 'A4.4';

-- 2c. Provisiones: A4.6 → A4.4
UPDATE raw.eeff_observacion
SET cuenta_codigo = 'A4.4'
WHERE tipo_entidad  LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND cuenta_codigo = 'A4.6';

-- 2d. Intereses y Comisiones no Devengados: A4.7 → A4.5
UPDATE raw.eeff_observacion
SET cuenta_codigo = 'A4.5'
WHERE tipo_entidad  LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND cuenta_codigo = 'A4.7';

-- 2e. Insertar fila Atrasados (A4.3 = Vencidos + CobranzaJud) para histórico.
-- Los A4.3.1 y A4.3.2 ya fueron renombrados en 2a/2b.
-- ON CONFLICT: si A4.3 ya existe (re-ejecución), no hacer nada.
INSERT INTO raw.eeff_observacion
    (periodo, fecha_cierre, tipo_estado,
     empresa_sbs, nomb_correg, tipo_entidad,
     microfinanciera, nacional, moneda,
     cuenta_codigo, cuenta_nombre, valor,
     source, pais, regulador)
SELECT
    periodo,
    MAX(fecha_cierre)    AS fecha_cierre,
    tipo_estado,
    MAX(empresa_sbs)     AS empresa_sbs,
    nomb_correg,
    tipo_entidad,
    MAX(microfinanciera) AS microfinanciera,
    MAX(nacional)        AS nacional,
    moneda,
    'A4.3'               AS cuenta_codigo,
    'Atrasados'          AS cuenta_nombre,
    SUM(valor)           AS valor,
    'migration_v203'     AS source,
    pais,
    MAX(regulador)       AS regulador
FROM raw.eeff_observacion
WHERE tipo_entidad  LIKE 'COOPAC_%'
  AND tipo_estado   = 'balance'
  AND cuenta_codigo IN ('A4.3.1', 'A4.3.2')
GROUP BY periodo, tipo_estado, nomb_correg, tipo_entidad, moneda, pais
ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo) DO NOTHING;

-- -------------------------------------------------------------------------
-- 3. Recrear analytics.v_dupont_coopac con semántica correcta
-- -------------------------------------------------------------------------

DROP VIEW IF EXISTS analytics.v_dupont_coopac;

CREATE VIEW analytics.v_dupont_coopac AS
WITH gyp AS (
    SELECT
        periodo,
        nomb_correg,
        tipo_entidad,
        moneda,
        MAX(CASE WHEN cuenta_codigo = '1'  THEN valor END) AS if_,
        MAX(CASE WHEN cuenta_codigo = '2'  THEN valor END) AS gf,
        MAX(CASE WHEN cuenta_codigo = '4'  THEN valor END) AS prov_gyp,
        MAX(CASE WHEN cuenta_codigo = '10' THEN valor END) AS ga,
        MAX(CASE WHEN cuenta_codigo = '12' THEN valor END) AS dep_amort,
        MAX(CASE WHEN cuenta_codigo = '13' THEN valor END) AS otros,
        MAX(CASE WHEN cuenta_codigo = '17' THEN valor END) AS rn
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
        MAX(CASE WHEN cuenta_codigo = 'A'      THEN valor END) AS activo,
        MAX(CASE WHEN cuenta_codigo = 'B'      THEN valor END) AS pasivo,
        MAX(CASE WHEN cuenta_codigo = 'C'      THEN valor END) AS patrimonio,
        MAX(CASE WHEN cuenta_codigo = 'A4.1'   THEN valor END) AS vigentes,
        MAX(CASE WHEN cuenta_codigo = 'A4.2'   THEN valor END) AS refinanciados,
        MAX(CASE WHEN cuenta_codigo = 'A4.3'   THEN valor END) AS atrasados,
        MAX(CASE WHEN cuenta_codigo = 'A4.3.1' THEN valor END) AS vencidos,
        MAX(CASE WHEN cuenta_codigo = 'A4.3.2' THEN valor END) AS en_cobranza,
        ABS(MAX(CASE WHEN cuenta_codigo = 'A4.4' THEN valor END)) AS prov_bg,
        MAX(CASE WHEN cuenta_codigo = 'B1'    THEN valor END) AS depositos_socios
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

    -- DuPont 3-factor
    ROUND(g.rn     / NULLIF(g.if_, 0)    * 100, 2) AS margen_neto_pct,
    ROUND(g.if_    / NULLIF(b.activo, 0) * 100, 2) AS rotacion_activos_pct,
    ROUND(b.activo / NULLIF(b.patrimonio, 0),   2) AS apalancamiento,
    ROUND(g.rn     / NULLIF(b.patrimonio, 0) * 100, 2) AS roe_pct,
    ROUND(g.rn     / NULLIF(b.activo, 0)     * 100, 2) AS roa_pct,

    -- DuPont extendido: waterfall de márgenes
    ROUND(g.gf        / NULLIF(g.if_, 0) * 100, 2) AS gf_sobre_if_pct,
    ROUND(g.prov_gyp  / NULLIF(g.if_, 0) * 100, 2) AS prov_sobre_if_pct,
    ROUND(g.ga        / NULLIF(g.if_, 0) * 100, 2) AS ga_sobre_if_pct,
    ROUND(g.dep_amort / NULLIF(g.if_, 0) * 100, 2) AS dep_sobre_if_pct,
    ROUND(g.otros     / NULLIF(g.if_, 0) * 100, 2) AS otros_sobre_if_pct,

    -- Calidad de cartera — uniforme con SF: Atrasados = subtotal A4.3
    ROUND(
        b.vigentes + b.refinanciados + b.atrasados, 2
    ) AS cartera_bruta,
    ROUND(
        b.atrasados /
        NULLIF(b.vigentes + b.refinanciados + b.atrasados, 0) * 100, 2
    ) AS mora_pct,
    ROUND(
        b.prov_bg / NULLIF(b.atrasados, 0) * 100, 2
    ) AS cobertura_car_pct,

    -- Rendimiento y eficiencia
    ROUND(
        g.if_ / NULLIF(b.vigentes + b.refinanciados + b.atrasados, 0) * 100, 2
    ) AS yield_cartera_pct,
    ROUND(b.depositos_socios / NULLIF(b.activo, 0) * 100, 2) AS depositos_sobre_activo_pct,

    -- Montos base (miles de soles)
    b.activo,
    b.patrimonio,
    g.if_,
    g.rn,
    g.ga

FROM gyp g
JOIN bg b USING (periodo, nomb_correg, tipo_entidad, moneda)
WHERE g.if_       IS NOT NULL
  AND b.activo    IS NOT NULL
  AND b.patrimonio IS NOT NULL;

COMMENT ON VIEW analytics.v_dupont_coopac IS
    'DuPont decomposition para cooperativas COOPAC. '
    'Cartera Bruta = Vigentes + Refinanciados + Atrasados (subtotal A4.3). '
    'Semántica A4.x unificada con SF desde V203: A4.3=Atrasados, '
    'A4.3.1=Vencidos, A4.3.2=CobranzaJud, A4.4=Provisiones. '
    'ga_sobre_if_pct puede ser NULL para N3 periodos 202605/202608 (gap en datos SBS). '
    'Usar COALESCE(ga_sobre_if_pct, 0) solo en display — no imputar en análisis. '
    'Unidades monetarias: miles de soles (misma escala que raw.eeff_observacion).';

-- -------------------------------------------------------------------------
-- 4. Refrescar MV de balance con los nuevos códigos
-- -------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW marts.mv_eeff_balance_ancho;
