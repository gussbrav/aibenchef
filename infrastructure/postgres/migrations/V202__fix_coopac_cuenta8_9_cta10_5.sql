-- =========================================================================
-- V202: Fix mapeo código 8/9 COOPAC + añadir cta_10_5 a MV resultados
--
-- Problemas detectados contra el Excel oficial SBS "CONSOLIDADO GYP SBS
-- COOPAC Y CAJA.xlsx":
--
--   1. V201 mapeó "Utilidad/Pérdida por Venta de Cartera Crediticia" al
--      código '9' en dw.cabecera_maestra. El código correcto es '8' —
--      igual que en SF. Código '9' = MARGEN OPERACIONAL en ambos.
--
--   2. V201 asignó código '9' a "UTILID/PERDIDA VENTA CARTERA" en la
--      cabecera de COOPAC. Debe ser "MARGEN OPERACIONAL".
--
--   3. marts.mv_eeff_resultados_ancho no tiene cta_10_5 (Actividades
--      Asociativas), cuenta COOPAC-específica bajo Gastos Administrativos.
--      En el Excel oficial aparece antes de Impuestos (10.4), pero usamos
--      10.5 para mantener consistencia semántica con SF (10.4=Impuestos).
--
--   4. Cuentas de totales intermedios faltantes en cabecera COOPAC:
--      Margen Financiero Neto (5), Margen Operacional (9),
--      Margen Operacional Neto (11).
--
--   5. Sub-cuentas de Ingresos/Gastos por Servicios Financieros (6.x,
--      7.x) faltantes en cabecera COOPAC.
--
-- IDEMPOTENTE: UPDATE es idempotente por naturaleza. INSERT ON CONFLICT
-- DO NOTHING. DROP + CREATE MV sin estado persistido.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix código '8' COOPAC: nombre_fuente correcto del Excel oficial
--    Excel dice: "UTILIDAD (PÉRDIDA) POR VENTA DE CARTERA CREDITICIA"
--    V201 tenía: nombre_fuente = 'Resultado por Operaciones Financieras'
-- ---------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
SET nombre_fuente = 'Utilidad Perdida por Venta de Cartera Crediticia'
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND tipo_estado  = 'resultados'
  AND codigo       = '8'
  AND valido_hasta IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Fix código '9' COOPAC: era "UTILID/PERDIDA VENTA CARTERA" (incorrecto)
--    Debe ser MARGEN OPERACIONAL (igual que SF, posición 9 en P&G)
-- ---------------------------------------------------------------------------
UPDATE dw.cabecera_maestra
SET nombre        = 'MARGEN OPERACIONAL',
    nombre_fuente = NULL
WHERE tipo_entidad LIKE 'COOPAC_%'
  AND tipo_estado  = 'resultados'
  AND codigo       = '9'
  AND valido_hasta IS NULL;

-- ---------------------------------------------------------------------------
-- 3. INSERT cuentas faltantes en cabecera COOPAC (resultados)
--    - Totales intermedios: 5 (Margen Fin Neto), 11 (Margen Op Neto)
--    - Sub-cuentas Ingresos Servicios: 6.1, 6.2, 6.3, 6.4
--    - Sub-cuentas Gastos Servicios: 7.1, 7.2, 7.3, 7.4
-- ---------------------------------------------------------------------------
INSERT INTO dw.cabecera_maestra
    (tipo_estado, tipo_entidad, orden, codigo, nombre,
     nivel, es_header, es_total, es_seccion, valido_desde,
     nombre_fuente, parent_codigo)
SELECT
    v.tipo_estado, g.tipo_entidad, v.orden, v.codigo, v.nombre,
    v.nivel, v.es_header, v.es_total, v.es_seccion, 202401,
    v.nombre_fuente, v.parent_codigo
FROM (VALUES
--  t_estado          ord  codigo  nombre_display                           niv  hdr    tot    sec    nombre_fuente                                           parent
    ('resultados'::TEXT, 50, '5',   'MARGEN FINANCIERO NETO',               2, TRUE,  FALSE, FALSE, NULL::TEXT,                                             NULL::TEXT),
    ('resultados',       51, '11',  'MARGEN OPERACIONAL NETO',              2, TRUE,  FALSE, FALSE, NULL,                                                   NULL      ),
    -- Ingresos por Servicios Financieros sub-cuentas
    ('resultados',       52, '6.1', 'Cuentas por Cobrar IF',                3, FALSE, FALSE, FALSE, 'Cuentas por Cobrar',                                   '6'       ),
    ('resultados',       53, '6.2', 'Creditos Indirectos IF',               3, FALSE, FALSE, FALSE, 'Creditos Indirectos',                                  '6'       ),
    ('resultados',       54, '6.3', 'Fideicomisos IF',                      3, FALSE, FALSE, FALSE, 'Fideicomisos',                                         '6'       ),
    ('resultados',       55, '6.4', 'Ingresos Diversos IF',                 3, FALSE, FALSE, FALSE, 'Ingresos Diversos',                                    '6'       ),
    -- Gastos por Servicios Financieros sub-cuentas
    ('resultados',       56, '7.1', 'Cuentas por Pagar GF',                3, FALSE, FALSE, FALSE, 'Cuentas por Pagar',                                    '7'       ),
    ('resultados',       57, '7.2', 'Creditos Indirectos GF',               3, FALSE, FALSE, FALSE, 'Creditos Indirectos',                                  '7'       ),
    ('resultados',       58, '7.3', 'Fideicomisos GF',                      3, FALSE, FALSE, FALSE, 'Fideicomisos',                                         '7'       ),
    ('resultados',       59, '7.4', 'Gastos Diversos GF',                   3, FALSE, FALSE, FALSE, 'Gastos Diversos',                                      '7'       )
) AS v(tipo_estado, orden, codigo, nombre, nivel, es_header, es_total, es_seccion, nombre_fuente, parent_codigo)
CROSS JOIN (VALUES
    ('COOPAC_N3'::TEXT), ('COOPAC_N2B'), ('COOPAC_N2A'), ('COOPAC_N1')
) AS g(tipo_entidad)
ON CONFLICT (tipo_estado, tipo_entidad, orden, valido_desde) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. mv_eeff_resultados_ancho — añadir cta_10_5 (Actividades Asociativas)
--
-- Estrategia de posición en nuestro esquema interno:
--   10.4 = Impuestos y Contribuciones (igual para SF y COOPAC → semántica
--           consistente en cta_10_4 entre segmentos)
--   10.5 = Actividades Asociativas (COOPAC-específico, NULL para SF)
--
-- En el Excel oficial COOPAC, Actividades Asociativas aparece ANTES de
-- Impuestos (display order), pero asignamos 10.5 para no romper el
-- significado de cta_10_4 en las entidades SF existentes.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS marts.mv_eeff_resultados_ancho CASCADE;

CREATE MATERIALIZED VIEW marts.mv_eeff_resultados_ancho AS
SELECT
    periodo,
    MAX(fecha_cierre)    AS fecha_cierre,
    nomb_correg,
    MAX(empresa_sbs)     AS empresa_sbs,
    MAX(tipo_entidad)    AS tipo_entidad,
    MAX(microfinanciera) AS microfinanciera,
    MAX(nacional)        AS nacional,
    moneda,
    MAX(CASE WHEN cuenta_codigo = '1' THEN valor END) AS cta_1  /* INGRESOS FINANCIEROS */,
    MAX(CASE WHEN cuenta_codigo = '1.1' THEN valor END) AS cta_1_1  /* Disponible */,
    MAX(CASE WHEN cuenta_codigo = '1.2' THEN valor END) AS cta_1_2  /* Fondos Interbancarios / Intercooperativos */,
    MAX(CASE WHEN cuenta_codigo = '1.3' THEN valor END) AS cta_1_3  /* Inversiones */,
    MAX(CASE WHEN cuenta_codigo = '1.4' THEN valor END) AS cta_1_4  /* Créditos Directos */,
    MAX(CASE WHEN cuenta_codigo = '1.5' THEN valor END) AS cta_1_5  /* Ganancias por Valorización de Inversiones */,
    MAX(CASE WHEN cuenta_codigo = '1.6' THEN valor END) AS cta_1_6  /* Ganancias por Inversiones en Subsidiarias */,
    MAX(CASE WHEN cuenta_codigo = '1.7' THEN valor END) AS cta_1_7  /* Diferencia de Cambio */,
    MAX(CASE WHEN cuenta_codigo = '1.8' THEN valor END) AS cta_1_8  /* Ganancias en Productos Financieros Derivados */,
    MAX(CASE WHEN cuenta_codigo = '1.9' THEN valor END) AS cta_1_9  /* Reajuste por Indexación (SF only) */,
    MAX(CASE WHEN cuenta_codigo = '1.10' THEN valor END) AS cta_1_10  /* Otros */,
    MAX(CASE WHEN cuenta_codigo = '2' THEN valor END) AS cta_2  /* GASTOS FINANCIEROS */,
    MAX(CASE WHEN cuenta_codigo = '2.1' THEN valor END) AS cta_2_1  /* Obligaciones con el Público / con los Socios */,
    MAX(CASE WHEN cuenta_codigo = '2.2' THEN valor END) AS cta_2_2  /* Depósitos SF / Depósitos de Coopac */,
    MAX(CASE WHEN cuenta_codigo = '2.3' THEN valor END) AS cta_2_3  /* Fondos Interbancarios / Intercooperativos */,
    MAX(CASE WHEN cuenta_codigo = '2.4' THEN valor END) AS cta_2_4  /* Adeudos y Obligaciones Financieras */,
    MAX(CASE WHEN cuenta_codigo = '2.5' THEN valor END) AS cta_2_5  /* Obligaciones en Circulación no Subordinadas */,
    MAX(CASE WHEN cuenta_codigo = '2.6' THEN valor END) AS cta_2_6  /* Obligaciones en Circulación Subordinadas */,
    MAX(CASE WHEN cuenta_codigo = '2.7' THEN valor END) AS cta_2_7  /* Pérdida por Valorización de Inversiones */,
    MAX(CASE WHEN cuenta_codigo = '2.8' THEN valor END) AS cta_2_8  /* Pérdidas por Inversiones en Subsidiarias */,
    MAX(CASE WHEN cuenta_codigo = '2.9' THEN valor END) AS cta_2_9  /* Primas al Fondo de Seguro de Depósitos */,
    MAX(CASE WHEN cuenta_codigo = '2.10' THEN valor END) AS cta_2_10  /* Diferencia de Cambio */,
    MAX(CASE WHEN cuenta_codigo = '2.11' THEN valor END) AS cta_2_11  /* Pérdidas en Productos Financieros Derivados */,
    MAX(CASE WHEN cuenta_codigo = '2.12' THEN valor END) AS cta_2_12  /* Reajuste por Indexación (SF only) */,
    MAX(CASE WHEN cuenta_codigo = '2.13' THEN valor END) AS cta_2_13  /* Otros Gastos Financieros */,
    MAX(CASE WHEN cuenta_codigo = '3' THEN valor END) AS cta_3  /* MARGEN FINANCIERO BRUTO */,
    MAX(CASE WHEN cuenta_codigo = '4' THEN valor END) AS cta_4  /* PROVISIONES PARA CRÉDITOS DIRECTOS */,
    MAX(CASE WHEN cuenta_codigo = '4.1' THEN valor END) AS cta_4_1  /* Provisiones para Desvalorización de Inversiones */,
    MAX(CASE WHEN cuenta_codigo = '4.2' THEN valor END) AS cta_4_2  /* Provisiones para Incobrabilidad de Créditos */,
    MAX(CASE WHEN cuenta_codigo = '5' THEN valor END) AS cta_5  /* MARGEN FINANCIERO NETO */,
    MAX(CASE WHEN cuenta_codigo = '6' THEN valor END) AS cta_6  /* INGRESOS POR SERVICIOS FINANCIEROS */,
    MAX(CASE WHEN cuenta_codigo = '6.1' THEN valor END) AS cta_6_1  /* Cuentas por Cobrar */,
    MAX(CASE WHEN cuenta_codigo = '6.2' THEN valor END) AS cta_6_2  /* Créditos Indirectos */,
    MAX(CASE WHEN cuenta_codigo = '6.3' THEN valor END) AS cta_6_3  /* Fideicomisos y Comisiones de Confianza */,
    MAX(CASE WHEN cuenta_codigo = '6.4' THEN valor END) AS cta_6_4  /* Ingresos Diversos */,
    MAX(CASE WHEN cuenta_codigo = '7' THEN valor END) AS cta_7  /* GASTOS POR SERVICIOS FINANCIEROS */,
    MAX(CASE WHEN cuenta_codigo = '7.1' THEN valor END) AS cta_7_1  /* Cuentas por Pagar */,
    MAX(CASE WHEN cuenta_codigo = '7.2' THEN valor END) AS cta_7_2  /* Créditos Indirectos */,
    MAX(CASE WHEN cuenta_codigo = '7.3' THEN valor END) AS cta_7_3  /* Fideicomisos y Comisiones de Confianza */,
    MAX(CASE WHEN cuenta_codigo = '7.4' THEN valor END) AS cta_7_4  /* Gastos Diversos */,
    MAX(CASE WHEN cuenta_codigo = '8' THEN valor END) AS cta_8  /* UTILIDAD (PÉRDIDA) POR VENTA DE CARTERA */,
    MAX(CASE WHEN cuenta_codigo = '9' THEN valor END) AS cta_9  /* MARGEN OPERACIONAL */,
    MAX(CASE WHEN cuenta_codigo = '10' THEN valor END) AS cta_10  /* GASTOS ADMINISTRATIVOS */,
    MAX(CASE WHEN cuenta_codigo = '10.1' THEN valor END) AS cta_10_1  /* Personal */,
    MAX(CASE WHEN cuenta_codigo = '10.2' THEN valor END) AS cta_10_2  /* Directorio */,
    MAX(CASE WHEN cuenta_codigo = '10.3' THEN valor END) AS cta_10_3  /* Servicios Recibidos de Terceros */,
    MAX(CASE WHEN cuenta_codigo = '10.4' THEN valor END) AS cta_10_4  /* Impuestos y Contribuciones */,
    MAX(CASE WHEN cuenta_codigo = '10.5' THEN valor END) AS cta_10_5  /* Actividades Asociativas (COOPAC) */,
    MAX(CASE WHEN cuenta_codigo = '11' THEN valor END) AS cta_11  /* MARGEN OPERACIONAL NETO */,
    MAX(CASE WHEN cuenta_codigo = '12' THEN valor END) AS cta_12  /* PROVISIONES, DEPRECIACIÓN Y AMORTIZACIÓN */,
    MAX(CASE WHEN cuenta_codigo = '12.1' THEN valor END) AS cta_12_1  /* Provisiones para Contingencias y Otras */,
    MAX(CASE WHEN cuenta_codigo = '12.2' THEN valor END) AS cta_12_2  /* Provisiones para Créditos Indirectos */,
    MAX(CASE WHEN cuenta_codigo = '12.3' THEN valor END) AS cta_12_3  /* Provisiones por Pérdida por Deterioro de Inversiones */,
    MAX(CASE WHEN cuenta_codigo = '12.4' THEN valor END) AS cta_12_4  /* Provisiones para Incobrabilidad de Cuentas por Cobrar */,
    MAX(CASE WHEN cuenta_codigo = '12.5' THEN valor END) AS cta_12_5  /* Provisiones para Bienes Realizables */,
    MAX(CASE WHEN cuenta_codigo = '12.6' THEN valor END) AS cta_12_6  /* Otras Provisiones */,
    MAX(CASE WHEN cuenta_codigo = '12.7' THEN valor END) AS cta_12_7  /* Depreciación */,
    MAX(CASE WHEN cuenta_codigo = '12.8' THEN valor END) AS cta_12_8  /* Amortización */,
    MAX(CASE WHEN cuenta_codigo = '13' THEN valor END) AS cta_13  /* OTROS INGRESOS Y GASTOS */,
    MAX(CASE WHEN cuenta_codigo = '13.1' THEN valor END) AS cta_13_1  /* Ingresos (Gastos) por Recuperación de Créditos */,
    MAX(CASE WHEN cuenta_codigo = '13.2' THEN valor END) AS cta_13_2  /* Ingresos (Gastos) Extraordinarios */,
    MAX(CASE WHEN cuenta_codigo = '13.3' THEN valor END) AS cta_13_3  /* Ingresos (Gastos) de Ejercicios Anteriores */,
    MAX(CASE WHEN cuenta_codigo = '14' THEN valor END) AS cta_14  /* UTILIDAD (PÉRDIDA) ANTES DE PART. E IMP. */,
    MAX(CASE WHEN cuenta_codigo = '15' THEN valor END) AS cta_15  /* RESULTADO ANTES DEL IMPUESTO A LA RENTA */,
    MAX(CASE WHEN cuenta_codigo = '16' THEN valor END) AS cta_16  /* IMPUESTO A LA RENTA */,
    MAX(CASE WHEN cuenta_codigo = '17' THEN valor END) AS cta_17  /* RESULTADO NETO DEL EJERCICIO */
FROM raw.eeff_observacion
WHERE tipo_estado = 'resultados'
GROUP BY periodo, nomb_correg, moneda;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_eeff_resultados_ancho
    ON marts.mv_eeff_resultados_ancho (periodo, nomb_correg, moneda);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_resultados_ancho_periodo
    ON marts.mv_eeff_resultados_ancho (periodo);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_resultados_ancho_entidad
    ON marts.mv_eeff_resultados_ancho (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_mv_eeff_resultados_ancho_tipo
    ON marts.mv_eeff_resultados_ancho (tipo_entidad);

COMMENT ON MATERIALIZED VIEW marts.mv_eeff_resultados_ancho IS
    'Pivot wide-format de EEFF resultados. '
    'V202: añadió cta_10_5 (Actividades Asociativas COOPAC), cta_5 (MFN), cta_9 (MO), '
    'cta_11 (MON), sub-cuentas 6.x/7.x. '
    'cta_10_4 = Impuestos y Contribuciones para SF y COOPAC (semántica consistente). '
    'cta_10_5 = Actividades Asociativas COOPAC-only (NULL para SF). '
    'cta_1_9/cta_2_12 = Reajuste por Indexación (SF-only, NULL para COOPAC).';

-- ---------------------------------------------------------------------------
-- 5. Recrear vistas que CASCADE bajó al dropear mv_eeff_resultados_ancho.
--    Definiciones copiadas de V092 (última versión vigente).
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_entidad CASCADE;

CREATE MATERIALIZED VIEW marts.mv_kpis_anuales_entidad AS
WITH er_agg AS (
    SELECT periodo,
        dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
        SUM(cta_17)   AS cta_17_ytd, SUM(cta_1) AS cta_1_ytd, SUM(cta_2) AS cta_2_ytd,
        SUM(cta_6)    AS cta_6_ytd,  SUM(cta_7) AS cta_7_ytd,
        SUM(cta_10_1) AS cta_10_1_ytd, SUM(cta_10_2) AS cta_10_2_ytd,
        SUM(cta_10_3) AS cta_10_3_ytd, SUM(cta_10_4) AS cta_10_4_ytd,
        SUM(cta_12_7) AS cta_12_7_ytd, SUM(cta_12_8) AS cta_12_8_ytd
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg)
),
ttm AS (
    SELECT a.periodo, a.nomb_correg,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_17_ytd, 0)
             ELSE COALESCE(a.cta_17_ytd,0) + COALESCE(dp.cta_17_ytd,0) - COALESCE(mp.cta_17_ytd,0) END AS utilidad_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_1_ytd, 0)
             ELSE COALESCE(a.cta_1_ytd,0) + COALESCE(dp.cta_1_ytd,0) - COALESCE(mp.cta_1_ytd,0) END AS cta_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_2_ytd, 0)
             ELSE COALESCE(a.cta_2_ytd,0) + COALESCE(dp.cta_2_ytd,0) - COALESCE(mp.cta_2_ytd,0) END AS cta_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_6_ytd, 0)
             ELSE COALESCE(a.cta_6_ytd,0) + COALESCE(dp.cta_6_ytd,0) - COALESCE(mp.cta_6_ytd,0) END AS cta_6_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_7_ytd, 0)
             ELSE COALESCE(a.cta_7_ytd,0) + COALESCE(dp.cta_7_ytd,0) - COALESCE(mp.cta_7_ytd,0) END AS cta_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_1_ytd, 0)
             ELSE COALESCE(a.cta_10_1_ytd,0) + COALESCE(dp.cta_10_1_ytd,0) - COALESCE(mp.cta_10_1_ytd,0) END AS cta_10_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_2_ytd, 0)
             ELSE COALESCE(a.cta_10_2_ytd,0) + COALESCE(dp.cta_10_2_ytd,0) - COALESCE(mp.cta_10_2_ytd,0) END AS cta_10_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_3_ytd, 0)
             ELSE COALESCE(a.cta_10_3_ytd,0) + COALESCE(dp.cta_10_3_ytd,0) - COALESCE(mp.cta_10_3_ytd,0) END AS cta_10_3_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_4_ytd, 0)
             ELSE COALESCE(a.cta_10_4_ytd,0) + COALESCE(dp.cta_10_4_ytd,0) - COALESCE(mp.cta_10_4_ytd,0) END AS cta_10_4_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_7_ytd, 0)
             ELSE COALESCE(a.cta_12_7_ytd,0) + COALESCE(dp.cta_12_7_ytd,0) - COALESCE(mp.cta_12_7_ytd,0) END AS cta_12_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_8_ytd, 0)
             ELSE COALESCE(a.cta_12_8_ytd,0) + COALESCE(dp.cta_12_8_ytd,0) - COALESCE(mp.cta_12_8_ytd,0) END AS cta_12_8_ttm
    FROM er_agg a
    LEFT JOIN er_agg dp ON dp.nomb_correg = a.nomb_correg AND dp.periodo = (a.periodo / 100 - 1) * 100 + 12
    LEFT JOIN er_agg mp ON mp.nomb_correg = a.nomb_correg AND mp.periodo = a.periodo - 100
),
bg_raw AS (
    SELECT periodo,
           dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           cuenta_codigo,
           valor
    FROM raw.eeff_observacion
    WHERE tipo_estado = 'balance' AND moneda = 'TOTAL' AND nomb_correg IS NOT NULL
),
bg_pivot AS (
    SELECT periodo, nomb_correg,
        SUM(CASE WHEN cuenta_codigo = 'A9' THEN valor END) AS cta_a9,
        SUM(CASE WHEN cuenta_codigo = 'C6' THEN valor END) AS cta_c6,
        SUM(CASE WHEN cuenta_codigo = 'B9.2' THEN valor END) AS cta_b9_2,
        SUM(CASE WHEN cuenta_codigo ~ '^A[0-9]+$' THEN valor END) AS sum_a_all,
        SUM(CASE WHEN cuenta_codigo ~ '^C[0-9]+$' THEN valor END) AS sum_c_all
    FROM bg_raw GROUP BY periodo, nomb_correg
),
bg_agg AS (
    SELECT periodo, nomb_correg,
        CASE
            WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                 AND ABS(cta_a9 - cta_c6) < 1.0
            THEN cta_a9
            ELSE COALESCE(sum_a_all, 0)
        END AS activos,
        CASE
            WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                 AND ABS(cta_a9 - cta_c6) < 1.0
            THEN COALESCE(cta_c6, 0) - COALESCE(cta_b9_2, 0)
            ELSE COALESCE(sum_c_all, 0)
        END AS patrimonio
    FROM bg_pivot
),
bg_avg AS (
    SELECT b.periodo, b.nomb_correg,
           AVG(b_prev.activos) AS activos_prom_12m,
           AVG(b_prev.patrimonio) AS patrimonio_prom_12m
    FROM bg_agg b
    JOIN bg_agg b_prev
        ON b_prev.nomb_correg = b.nomb_correg
       AND b_prev.periodo BETWEEN
            CASE WHEN b.periodo % 100 >= 12 THEN b.periodo - 11
                 ELSE (b.periodo / 100 - 1) * 100 + (b.periodo % 100) + 1 END
            AND b.periodo
    GROUP BY b.periodo, b.nomb_correg
)
SELECT
    t.periodo, t.nomb_correg,
    t.utilidad_ttm, t.cta_1_ttm, t.cta_2_ttm, t.cta_6_ttm, t.cta_7_ttm,
    t.cta_10_1_ttm, t.cta_10_2_ttm, t.cta_10_3_ttm, t.cta_10_4_ttm,
    t.cta_12_7_ttm, t.cta_12_8_ttm,
    bavg.activos_prom_12m, bavg.patrimonio_prom_12m
FROM ttm t
LEFT JOIN bg_avg bavg ON bavg.periodo = t.periodo AND bavg.nomb_correg = t.nomb_correg;

CREATE UNIQUE INDEX IF NOT EXISTS mv_kpis_anuales_pk
    ON marts.mv_kpis_anuales_entidad (periodo, nomb_correg);
CREATE INDEX IF NOT EXISTS mv_kpis_anuales_periodo
    ON marts.mv_kpis_anuales_entidad (periodo);

CREATE OR REPLACE VIEW marts.v_kpis_anuales_entidad AS
SELECT * FROM marts.mv_kpis_anuales_entidad;

DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_historica CASCADE;

CREATE MATERIALIZED VIEW marts.mv_kpis_anuales_historica AS
WITH er_agg AS (
    SELECT periodo,
        dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
        SUM(cta_17)   AS cta_17_ytd, SUM(cta_1) AS cta_1_ytd, SUM(cta_2) AS cta_2_ytd,
        SUM(cta_6)    AS cta_6_ytd,  SUM(cta_7) AS cta_7_ytd,
        SUM(cta_10_1) AS cta_10_1_ytd, SUM(cta_10_2) AS cta_10_2_ytd,
        SUM(cta_10_3) AS cta_10_3_ytd, SUM(cta_10_4) AS cta_10_4_ytd,
        SUM(cta_12_7) AS cta_12_7_ytd, SUM(cta_12_8) AS cta_12_8_ytd
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo)
),
ttm AS (
    SELECT a.periodo, a.nomb_correg,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_17_ytd, 0)
             ELSE COALESCE(a.cta_17_ytd,0) + COALESCE(dp.cta_17_ytd,0) - COALESCE(mp.cta_17_ytd,0) END AS utilidad_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_1_ytd, 0)
             ELSE COALESCE(a.cta_1_ytd,0) + COALESCE(dp.cta_1_ytd,0) - COALESCE(mp.cta_1_ytd,0) END AS cta_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_2_ytd, 0)
             ELSE COALESCE(a.cta_2_ytd,0) + COALESCE(dp.cta_2_ytd,0) - COALESCE(mp.cta_2_ytd,0) END AS cta_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_6_ytd, 0)
             ELSE COALESCE(a.cta_6_ytd,0) + COALESCE(dp.cta_6_ytd,0) - COALESCE(mp.cta_6_ytd,0) END AS cta_6_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_7_ytd, 0)
             ELSE COALESCE(a.cta_7_ytd,0) + COALESCE(dp.cta_7_ytd,0) - COALESCE(mp.cta_7_ytd,0) END AS cta_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_1_ytd, 0)
             ELSE COALESCE(a.cta_10_1_ytd,0) + COALESCE(dp.cta_10_1_ytd,0) - COALESCE(mp.cta_10_1_ytd,0) END AS cta_10_1_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_2_ytd, 0)
             ELSE COALESCE(a.cta_10_2_ytd,0) + COALESCE(dp.cta_10_2_ytd,0) - COALESCE(mp.cta_10_2_ytd,0) END AS cta_10_2_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_3_ytd, 0)
             ELSE COALESCE(a.cta_10_3_ytd,0) + COALESCE(dp.cta_10_3_ytd,0) - COALESCE(mp.cta_10_3_ytd,0) END AS cta_10_3_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_10_4_ytd, 0)
             ELSE COALESCE(a.cta_10_4_ytd,0) + COALESCE(dp.cta_10_4_ytd,0) - COALESCE(mp.cta_10_4_ytd,0) END AS cta_10_4_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_7_ytd, 0)
             ELSE COALESCE(a.cta_12_7_ytd,0) + COALESCE(dp.cta_12_7_ytd,0) - COALESCE(mp.cta_12_7_ytd,0) END AS cta_12_7_ttm,
        CASE WHEN a.periodo % 100 = 1 THEN COALESCE(dp.cta_12_8_ytd, 0)
             ELSE COALESCE(a.cta_12_8_ytd,0) + COALESCE(dp.cta_12_8_ytd,0) - COALESCE(mp.cta_12_8_ytd,0) END AS cta_12_8_ttm
    FROM er_agg a
    LEFT JOIN er_agg dp ON dp.nomb_correg = a.nomb_correg AND dp.periodo = (a.periodo / 100 - 1) * 100 + 12
    LEFT JOIN er_agg mp ON mp.nomb_correg = a.nomb_correg AND mp.periodo = a.periodo - 100
),
bg_raw AS (
    SELECT periodo,
           dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           cuenta_codigo,
           valor
    FROM raw.eeff_observacion
    WHERE tipo_estado = 'balance' AND moneda = 'TOTAL' AND nomb_correg IS NOT NULL
),
bg_pivot AS (
    SELECT periodo, nomb_correg,
        SUM(CASE WHEN cuenta_codigo = 'A9' THEN valor END) AS cta_a9,
        SUM(CASE WHEN cuenta_codigo = 'C6' THEN valor END) AS cta_c6,
        SUM(CASE WHEN cuenta_codigo = 'B9.2' THEN valor END) AS cta_b9_2,
        SUM(CASE WHEN cuenta_codigo ~ '^A[0-9]+$' THEN valor END) AS sum_a_all,
        SUM(CASE WHEN cuenta_codigo ~ '^C[0-9]+$' THEN valor END) AS sum_c_all
    FROM bg_raw GROUP BY periodo, nomb_correg
),
bg_agg AS (
    SELECT periodo, nomb_correg,
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                  AND ABS(cta_a9 - cta_c6) < 1.0
            THEN cta_a9
            ELSE COALESCE(sum_a_all, 0)
        END AS activos,
        CASE WHEN cta_a9 IS NOT NULL AND cta_c6 IS NOT NULL
                  AND ABS(cta_a9 - cta_c6) < 1.0
            THEN COALESCE(cta_c6, 0) - COALESCE(cta_b9_2, 0)
            ELSE COALESCE(sum_c_all, 0)
        END AS patrimonio
    FROM bg_pivot
),
bg_avg AS (
    SELECT b.periodo, b.nomb_correg,
           AVG(b_prev.activos) AS activos_prom_12m,
           AVG(b_prev.patrimonio) AS patrimonio_prom_12m
    FROM bg_agg b
    JOIN bg_agg b_prev ON b_prev.nomb_correg = b.nomb_correg
       AND b_prev.periodo BETWEEN
            CASE WHEN b.periodo % 100 >= 12 THEN b.periodo - 11
                 ELSE (b.periodo / 100 - 1) * 100 + (b.periodo % 100) + 1 END
            AND b.periodo
    GROUP BY b.periodo, b.nomb_correg
)
SELECT t.periodo, t.nomb_correg,
    t.utilidad_ttm, t.cta_1_ttm, t.cta_2_ttm, t.cta_6_ttm, t.cta_7_ttm,
    t.cta_10_1_ttm, t.cta_10_2_ttm, t.cta_10_3_ttm, t.cta_10_4_ttm,
    t.cta_12_7_ttm, t.cta_12_8_ttm,
    bavg.activos_prom_12m, bavg.patrimonio_prom_12m
FROM ttm t
LEFT JOIN bg_avg bavg ON bavg.periodo = t.periodo AND bavg.nomb_correg = t.nomb_correg;

CREATE UNIQUE INDEX IF NOT EXISTS mv_kpis_anuales_hist_pk
    ON marts.mv_kpis_anuales_historica (periodo, nomb_correg);

CREATE OR REPLACE VIEW marts.v_kpis_anuales_historica AS
SELECT * FROM marts.mv_kpis_anuales_historica;
