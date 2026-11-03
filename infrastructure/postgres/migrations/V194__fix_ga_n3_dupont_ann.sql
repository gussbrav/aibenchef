-- =========================================================================
-- V194: Fix GA N3 202605/202608 + DuPont view anualizada
--
-- PROBLEMA RAIZ:
--   En los archivos SC-0002-my2026.xls y SC-0002-ag2026.xls, SBS publicó
--   "GASTOS ADMINISTRATIVOS" en formato title-case (mixed-case) en lugar
--   de ALL CAPS. El parser COOPAC interpreta ALL CAPS como header; al
--   ver la fila en mixed-case la trata como hijo sin padre y la descarta.
--
--   Evidencia en celda_cruda: orden=39 es_header=FALSE para esos periodos,
--   y el valor en ese orden es consistente con la tendencia YTD entre
--   202604 y 202606 (incremento mensual ~1.7k/mes para Abaco, etc.).
--
-- FIX PARTE 1: Insertar observaciones GA reconstruidas desde celda_cruda
--   - Fuente: orden=39 de raw.eeff_celda_cruda (valor_mn, valor_me, valor_total)
--   - Se insertan 3 filas por entidad (MN, ME, TOTAL) para 202605 y 202608
--   - Total: 18 periodos × 3 monedas = 54 observaciones reconstruidas
--   - ON CONFLICT DO NOTHING: idempotente
--
-- FIX PARTE 2: Reemplazar analytics.v_dupont_coopac con métricas anualizadas
--   - P&L YTD × (12/mes) para comparabilidad entre periodos
--   - Se mantienen también las métricas crudas YTD para referencia
--   - La identidad DuPont se cumple sobre las métricas anualizadas
--
-- ROLLBACK:
--   DELETE FROM raw.eeff_observacion
--     WHERE tipo_entidad='COOPAC_N3' AND tipo_estado='resultados'
--       AND cuenta_codigo='10' AND periodo IN (202605, 202608)
--       AND source_file IN ('SC-0002-my2026.xls', 'SC-0002-ag2026.xls');
--   UPDATE raw.eeff_celda_cruda SET cuenta_codigo=NULL
--     WHERE tipo_entidad='COOPAC_N3' AND tipo_estado='resultados'
--       AND periodo IN (202605, 202608) AND orden=39;
--   DROP VIEW IF EXISTS analytics.v_dupont_coopac;
--   -- restaurar V193 desde backup o git
-- =========================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1 — Reconstruir observaciones GA para N3 202605 y 202608
-- ---------------------------------------------------------------------------

-- Insertar para moneda TOTAL
INSERT INTO raw.eeff_observacion
    (periodo, fecha_cierre, tipo_estado, empresa_sbs, nomb_correg, tipo_entidad,
     microfinanciera, nacional, moneda, cuenta_codigo, cuenta_nombre, valor,
     source, source_file)
SELECT
    cc.periodo,
    CASE cc.periodo WHEN 202605 THEN '2026-05-31'::date ELSE '2026-08-31'::date END,
    'resultados',
    NULL,
    cc.nomb_correg,
    'COOPAC_N3',
    NULL,
    NULL,
    'TOTAL',
    '10',
    'GASTOS ADMINISTRATIVOS',
    cc.valor_total,
    'monthly_eeff',
    cc.source_file
FROM raw.eeff_celda_cruda cc
WHERE cc.tipo_entidad = 'COOPAC_N3'
  AND cc.tipo_estado  = 'resultados'
  AND cc.periodo      IN (202605, 202608)
  AND cc.orden        = 39
  AND cc.cuenta_codigo IS NULL
  AND cc.es_header    = FALSE
  AND cc.valor_total  IS NOT NULL
ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo) DO NOTHING;

-- Insertar para moneda MN
INSERT INTO raw.eeff_observacion
    (periodo, fecha_cierre, tipo_estado, empresa_sbs, nomb_correg, tipo_entidad,
     microfinanciera, nacional, moneda, cuenta_codigo, cuenta_nombre, valor,
     source, source_file)
SELECT
    cc.periodo,
    CASE cc.periodo WHEN 202605 THEN '2026-05-31'::date ELSE '2026-08-31'::date END,
    'resultados',
    NULL,
    cc.nomb_correg,
    'COOPAC_N3',
    NULL,
    NULL,
    'MN',
    '10',
    'GASTOS ADMINISTRATIVOS',
    cc.valor_mn,
    'monthly_eeff',
    cc.source_file
FROM raw.eeff_celda_cruda cc
WHERE cc.tipo_entidad = 'COOPAC_N3'
  AND cc.tipo_estado  = 'resultados'
  AND cc.periodo      IN (202605, 202608)
  AND cc.orden        = 39
  AND cc.cuenta_codigo IS NULL
  AND cc.es_header    = FALSE
  AND cc.valor_mn     IS NOT NULL
ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo) DO NOTHING;

-- Insertar para moneda ME
INSERT INTO raw.eeff_observacion
    (periodo, fecha_cierre, tipo_estado, empresa_sbs, nomb_correg, tipo_entidad,
     microfinanciera, nacional, moneda, cuenta_codigo, cuenta_nombre, valor,
     source, source_file)
SELECT
    cc.periodo,
    CASE cc.periodo WHEN 202605 THEN '2026-05-31'::date ELSE '2026-08-31'::date END,
    'resultados',
    NULL,
    cc.nomb_correg,
    'COOPAC_N3',
    NULL,
    NULL,
    'ME',
    '10',
    'GASTOS ADMINISTRATIVOS',
    cc.valor_me,
    'monthly_eeff',
    cc.source_file
FROM raw.eeff_celda_cruda cc
WHERE cc.tipo_entidad = 'COOPAC_N3'
  AND cc.tipo_estado  = 'resultados'
  AND cc.periodo      IN (202605, 202608)
  AND cc.orden        = 39
  AND cc.cuenta_codigo IS NULL
  AND cc.es_header    = FALSE
  AND cc.valor_me     IS NOT NULL
ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo) DO NOTHING;

-- Marcar en celda_cruda para que el inspector las muestre correctamente
UPDATE raw.eeff_celda_cruda
SET cuenta_codigo = '10'
WHERE tipo_entidad  = 'COOPAC_N3'
  AND tipo_estado   = 'resultados'
  AND periodo       IN (202605, 202608)
  AND orden         = 39
  AND cuenta_codigo IS NULL
  AND es_header     = FALSE;

-- ---------------------------------------------------------------------------
-- PARTE 2 — Vista DuPont COOPAC con métricas anualizadas
--
-- Los archivos COOPAC publican P&L acumulado YTD (ene→mes).
-- Para comparar ROE/ROA entre periodos (y con el SF), se anualizan
-- multiplicando el P&L por (12 / número de mes).
-- Los valores de balance son snapshot de fin de periodo (sin ajuste).
--
-- ann_factor = 12.0 / (periodo % 100)
-- Ej: periodo=202607 → ann_factor=12/7=1.71429
--
-- Columnas con sufijo _ann: métricas anualizadas (usar para comparación)
-- Columnas con sufijo _ytd: métricas en bruto acumulado (referencia)
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS analytics.v_dupont_coopac;

CREATE VIEW analytics.v_dupont_coopac AS
WITH gyp AS (
    SELECT
        periodo,
        nomb_correg,
        tipo_entidad,
        moneda,
        12.0 / (periodo % 100)                                        AS ann_factor,
        MAX(CASE WHEN cuenta_codigo = '1'   THEN valor END)           AS if_ytd,
        MAX(CASE WHEN cuenta_codigo = '2'   THEN valor END)           AS gf_ytd,
        MAX(CASE WHEN cuenta_codigo = '4'   THEN valor END)           AS prov_gyp_ytd,
        MAX(CASE WHEN cuenta_codigo = '10'  THEN valor END)           AS ga_ytd,
        MAX(CASE WHEN cuenta_codigo = '12'  THEN valor END)           AS dep_amort_ytd,
        MAX(CASE WHEN cuenta_codigo = '13'  THEN valor END)           AS otros_ytd,
        MAX(CASE WHEN cuenta_codigo = '17'  THEN valor END)           AS rn_ytd
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
        MAX(CASE WHEN cuenta_codigo = 'A'    THEN valor END)          AS activo,
        MAX(CASE WHEN cuenta_codigo = 'B'    THEN valor END)          AS pasivo,
        MAX(CASE WHEN cuenta_codigo = 'C'    THEN valor END)          AS patrimonio,
        MAX(CASE WHEN cuenta_codigo = 'A4.1' THEN valor END)          AS vigentes,
        MAX(CASE WHEN cuenta_codigo = 'A4.2' THEN valor END)          AS refinanciados,
        MAX(CASE WHEN cuenta_codigo = 'A4.3' THEN valor END)          AS vencidos,
        MAX(CASE WHEN cuenta_codigo = 'A4.4' THEN valor END)          AS en_cobranza,
        ABS(MAX(CASE WHEN cuenta_codigo = 'A4.6' THEN valor END))     AS prov_bg,
        MAX(CASE WHEN cuenta_codigo = 'B1'   THEN valor END)          AS depositos_socios
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
    g.ann_factor,

    -- -----------------------------------------------------------------------
    -- DuPont 3-factor ANUALIZADO
    -- Identidad: roe_ann ≈ margen_neto_pct * rotacion_activos_ann / 100 * apalancamiento
    -- Margen neto es invariante a la anualización (ann_factor cancela en RN/IF).
    -- -----------------------------------------------------------------------
    ROUND(g.rn_ytd  / NULLIF(g.if_ytd, 0)        * 100, 2) AS margen_neto_pct,
    ROUND(g.if_ytd  * g.ann_factor / NULLIF(b.activo, 0) * 100, 2) AS rotacion_activos_ann,
    ROUND(b.activo  / NULLIF(b.patrimonio, 0),            2) AS apalancamiento,
    ROUND(g.rn_ytd  * g.ann_factor / NULLIF(b.patrimonio, 0) * 100, 2) AS roe_ann,
    ROUND(g.rn_ytd  * g.ann_factor / NULLIF(b.activo, 0) * 100, 2) AS roa_ann,

    -- -----------------------------------------------------------------------
    -- Waterfall de márgenes (componentes del margen neto — invariantes a ann)
    -- Suma aproximada: gf + prov + ga + dep + otros + margen ≈ 100
    -- -----------------------------------------------------------------------
    ROUND(g.gf_ytd        / NULLIF(g.if_ytd, 0) * 100, 2) AS gf_sobre_if_pct,
    ROUND(g.prov_gyp_ytd  / NULLIF(g.if_ytd, 0) * 100, 2) AS prov_sobre_if_pct,
    ROUND(g.ga_ytd        / NULLIF(g.if_ytd, 0) * 100, 2) AS ga_sobre_if_pct,
    ROUND(g.dep_amort_ytd / NULLIF(g.if_ytd, 0) * 100, 2) AS dep_sobre_if_pct,
    ROUND(g.otros_ytd     / NULLIF(g.if_ytd, 0) * 100, 2) AS otros_sobre_if_pct,

    -- -----------------------------------------------------------------------
    -- Calidad de cartera (balance — no requiere anualización)
    -- -----------------------------------------------------------------------
    (b.vigentes + b.refinanciados + b.vencidos + b.en_cobranza)       AS cartera_bruta,
    ROUND(
        (b.vencidos + b.en_cobranza) /
        NULLIF(b.vigentes + b.refinanciados + b.vencidos + b.en_cobranza, 0) * 100, 2
    )                                                                  AS mora_pct,
    ROUND(
        b.prov_bg /
        NULLIF(b.vencidos + b.en_cobranza, 0) * 100, 2
    )                                                                  AS cobertura_car_pct,

    -- -----------------------------------------------------------------------
    -- Rendimiento y eficiencia (anualizar el IF para yield de cartera)
    -- -----------------------------------------------------------------------
    ROUND(
        g.if_ytd * g.ann_factor /
        NULLIF(b.vigentes + b.refinanciados + b.vencidos + b.en_cobranza, 0) * 100, 2
    )                                                                  AS yield_cartera_ann,
    ROUND(b.depositos_socios / NULLIF(b.activo, 0) * 100, 2)          AS depositos_sobre_activo_pct,

    -- -----------------------------------------------------------------------
    -- Montos base (en unidades originales del archivo SBS — miles de soles)
    -- -----------------------------------------------------------------------
    b.activo,
    b.patrimonio,
    g.if_ytd,
    g.rn_ytd,
    g.ga_ytd,

    -- -----------------------------------------------------------------------
    -- Métricas YTD crudas (referencia — no comparar entre periodos distintos)
    -- -----------------------------------------------------------------------
    ROUND(g.rn_ytd  / NULLIF(g.if_ytd, 0)   * 100, 2) AS margen_neto_ytd_pct,
    ROUND(g.if_ytd  / NULLIF(b.activo, 0)   * 100, 2) AS rotacion_activos_ytd,
    ROUND(g.rn_ytd  / NULLIF(b.patrimonio, 0) * 100, 2) AS roe_ytd,
    ROUND(g.rn_ytd  / NULLIF(b.activo, 0)   * 100, 2) AS roa_ytd

FROM gyp g
JOIN bg b USING (periodo, nomb_correg, tipo_entidad, moneda)
WHERE g.if_ytd     IS NOT NULL
  AND b.activo     IS NOT NULL
  AND b.patrimonio IS NOT NULL;

COMMENT ON VIEW analytics.v_dupont_coopac IS
    'DuPont decomposition para cooperativas COOPAC. '
    'P&L anualizado: valor_ytd * (12 / mes_del_periodo). '
    'Balance: snapshot fin de periodo. '
    'Columnas *_ann: comparables entre periodos y con el SF. '
    'Columnas *_ytd: acumulado bruto (solo para referencia). '
    'ga_ytd puede ser NULL para N3 periodos 202605/202608 si re-importas '
    'desde cero sin aplicar V194 (la migration reconstruye esos datos).';
