-- =========================================================================
-- V070: Refactor de las vistas _historica para que usen NOMBRE VIGENTE
-- (el nombre que tenia la entidad en ese periodo, segun la cadena de
-- renombres) en lugar de INITCAP(limpiar_nombre_raw(...)).
--
-- Motivo: las vistas _historica de V069 devolvian el INITCAP del nombre
-- raw, que varia entre tablas (oficinas truncado, clientes/personal
-- ordenado distinto, etc.). El JOIN del cuadro resumen no matcheaba.
--
-- Logica nueva:
--   Para cada fila raw, computar canonico = resolver_nomb_correg_canonico(raw_name).
--   Luego nomb_correg_historico = nombre_vigente_en_periodo(canonico, periodo).
--   Eso garantiza:
--     - Mismo "nomb_correg" en TODAS las vistas para una entidad y periodo dados.
--     - El nombre coincide con lo que devuelve dw.nombre_vigente_en_periodo(),
--       que es lo que las CTEs en queries.ts usan como input.canon cuando
--       consolidar=false.
-- =========================================================================

-- Helper: para un raw_name, devolver el nombre vigente en periodo
CREATE OR REPLACE FUNCTION dw.raw_to_vigente(_raw TEXT, _periodo INT)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT dw.nombre_vigente_en_periodo(
        COALESCE(
            (SELECT em.nomb_correg_canonico
             FROM dw.entidad_nombre en JOIN dw.entidad_maestra em ON em.id = en.entidad_id
             WHERE LOWER(TRIM(en.nombre)) = LOWER(dw.limpiar_nombre_raw(_raw))
             LIMIT 1),
            INITCAP(dw.limpiar_nombre_raw(_raw))
        ),
        _periodo
    );
$$;

COMMENT ON FUNCTION dw.raw_to_vigente(TEXT, INT) IS
    'Mapea un nombre raw (ej. "Compartamos Financiera") al nombre vigente '
    'que tenia la entidad en _periodo (ej. "Financiera Compartamos" en 202004). '
    'Garantiza que las vistas _historica usen el mismo nomb_correg para una '
    'misma entidad-periodo, independiente de como aparezca en la fuente raw.';


-- ---------- REESCRIBIR VISTAS HISTORICA USANDO raw_to_vigente ----------
CREATE OR REPLACE VIEW marts.v_oficinas_por_entidad_historica AS
WITH base AS (
    SELECT
        o.periodo,
        o.codigo_oficina,
        dw.raw_to_vigente(o.empresa_sbs, o.periodo) AS nomb_correg
    FROM raw.creditos_depositos_oficina o
    WHERE o.empresa_sbs IS NOT NULL
      AND LOWER(TRIM(o.empresa_sbs)) NOT IN ('total general', 'total', '')
)
SELECT
    periodo, nomb_correg,
    COUNT(DISTINCT codigo_oficina) FILTER (WHERE codigo_oficina IS NOT NULL)::int AS n_oficinas
FROM base
WHERE nomb_correg IS NOT NULL AND nomb_correg <> ''
GROUP BY periodo, nomb_correg;


CREATE OR REPLACE VIEW marts.v_clientes_por_entidad_historica AS
SELECT
    periodo,
    dw.raw_to_vigente(c.empresa, c.periodo) AS nomb_correg,
    SUM(c.n_clientes)::int AS n_clientes
FROM raw.clientes_creditos c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.producto = 'TOTAL'
GROUP BY periodo, dw.raw_to_vigente(c.empresa, c.periodo);


CREATE OR REPLACE VIEW marts.v_personal_por_entidad_historica AS
SELECT
    periodo,
    dw.raw_to_vigente(p.empresa_sbs, p.periodo) AS nomb_correg,
    SUM(p.total)::int     AS n_personal,
    SUM(p.empleados)::int AS n_empleados
FROM raw.personal_observacion p
WHERE p.empresa_sbs IS NOT NULL
  AND LOWER(TRIM(p.empresa_sbs)) NOT IN ('total general', 'total', '')
  AND p.total IS NOT NULL
GROUP BY periodo, dw.raw_to_vigente(p.empresa_sbs, p.periodo);


CREATE OR REPLACE VIEW marts.v_colocaciones_agregado_historica AS
SELECT
    c.periodo,
    dw.raw_to_vigente(c.empresa, c.periodo) AS nomb_correg,
    SUM(c.saldo_vigente)     AS cartera_vigente,
    SUM(c.saldo_reest_refin) AS cartera_refin,
    SUM(c.saldo_atrasado)    AS cartera_atrasada,
    SUM(c.saldo_total)       AS cartera_total
FROM raw.colocaciones_observacion c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.saldo_total IS NOT NULL
GROUP BY c.periodo, dw.raw_to_vigente(c.empresa, c.periodo);


CREATE OR REPLACE VIEW marts.v_castigos_12m_historica AS
WITH base AS (
    SELECT DISTINCT periodo, dw.raw_to_vigente(entidad, periodo) AS nomb_correg
    FROM raw.castigos_observacion
    WHERE entidad IS NOT NULL
      AND LOWER(TRIM(entidad)) NOT IN ('total general', 'total', '')
)
SELECT
    p.periodo, p.nomb_correg,
    COALESCE(SUM(c.saldo_castigos), 0) AS castigos_12m
FROM base p
LEFT JOIN raw.castigos_observacion c
    ON dw.raw_to_vigente(c.entidad, p.periodo) = p.nomb_correg
   AND c.periodo BETWEEN
        (CASE WHEN p.periodo % 100 >= 12 THEN p.periodo - 11
              ELSE (p.periodo / 100 - 1) * 100 + (p.periodo % 100) + 1 END)
        AND p.periodo
GROUP BY p.periodo, p.nomb_correg;


CREATE OR REPLACE VIEW marts.v_mora_global_historica AS
SELECT
    col.periodo, col.nomb_correg,
    col.cartera_total AS cartera_bruta,
    col.cartera_atrasada, col.cartera_refin,
    COALESCE(cas.castigos_12m, 0) AS castigos_12m,
    CASE WHEN col.cartera_total > 0
         THEN ROUND(((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
                     / col.cartera_total)::numeric, 6)
         ELSE NULL END AS pct_mora_global,
    CASE WHEN col.cartera_total > 0
         THEN ROUND(((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
                     / col.cartera_total)::numeric, 6)
         ELSE NULL END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
       ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg;


CREATE OR REPLACE VIEW marts.v_cobertura_car_historica AS
SELECT
    b.periodo,
    dw.raw_to_vigente(b.nomb_correg, b.periodo) AS nomb_correg,
    SUM(cta_a4_2)      AS cartera_refinanciada,
    SUM(cta_a4_3)      AS cartera_atrasada,
    SUM(ABS(cta_a4_4)) AS provisiones,
    CASE WHEN SUM(cta_a4_2 + cta_a4_3) > 0
         THEN ROUND((SUM(ABS(cta_a4_4)) / SUM(cta_a4_2 + cta_a4_3))::numeric, 6)
         ELSE NULL END AS pct_cobertura_car
FROM marts.v_eeff_balance_ancho b
WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
GROUP BY b.periodo, dw.raw_to_vigente(b.nomb_correg, b.periodo);


CREATE OR REPLACE VIEW marts.v_microfinancieras_historica AS
WITH base AS (
    SELECT
        c.periodo,
        dw.raw_to_vigente(c.empresa, c.periodo) AS nomb_correg,
        CASE
            WHEN LOWER(TRIM(c.producto)) IN ('microempresa', 'a microempresas')
              OR LOWER(TRIM(c.producto)) LIKE 'peque%empresa%'
            THEN c.saldo_total ELSE 0
        END AS saldo_mype_row,
        c.saldo_total AS saldo_total_row
    FROM raw.colocaciones_observacion c
    WHERE c.empresa IS NOT NULL
      AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
      AND c.saldo_total IS NOT NULL
)
SELECT
    periodo, nomb_correg,
    CASE WHEN SUM(saldo_total_row) > 0
         THEN ROUND((SUM(saldo_mype_row)/SUM(saldo_total_row))::numeric, 6)
         ELSE NULL END AS pct_cartera_mype,
    (SUM(saldo_total_row) > 0 AND
     (SUM(saldo_mype_row)/SUM(saldo_total_row)) >= 0.5) AS es_microfinanciera
FROM base
GROUP BY periodo, nomb_correg
HAVING SUM(saldo_total_row) > 0;


CREATE OR REPLACE VIEW marts.v_participacion_smf_coloc_historica AS
WITH base AS (
    SELECT
        col.periodo, col.nomb_correg, col.cartera_total,
        mfi.es_microfinanciera
    FROM marts.v_colocaciones_agregado_historica col
    LEFT JOIN marts.v_microfinancieras_historica mfi
        ON mfi.periodo = col.periodo AND mfi.nomb_correg = col.nomb_correg
),
totales AS (
    SELECT periodo, SUM(cartera_total) AS total_smf
    FROM base WHERE COALESCE(es_microfinanciera, FALSE) = TRUE
    GROUP BY periodo
)
SELECT
    b.periodo, b.nomb_correg,
    COALESCE(b.es_microfinanciera, FALSE) AS es_smf,
    CASE WHEN COALESCE(b.es_microfinanciera, FALSE) AND t.total_smf > 0
         THEN ROUND((b.cartera_total / t.total_smf)::numeric, 6)
         ELSE 0 END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;


CREATE OR REPLACE VIEW marts.v_depositos_total_historica AS
SELECT
    d.periodo,
    dw.raw_to_vigente(d.empresa, d.periodo) AS nomb_correg,
    SUM(d.saldo_total) AS depositos_total
FROM raw.depositos_observacion d
WHERE d.empresa IS NOT NULL
  AND LOWER(TRIM(d.empresa)) NOT IN ('total general', 'total', '')
  AND d.saldo_total IS NOT NULL
GROUP BY d.periodo, dw.raw_to_vigente(d.empresa, d.periodo)
HAVING SUM(d.saldo_total) > 0;


CREATE OR REPLACE VIEW marts.v_participacion_smf_dep_historica AS
WITH base AS (
    SELECT
        dep.periodo, dep.nomb_correg, dep.depositos_total,
        mfi.es_microfinanciera
    FROM marts.v_depositos_total_historica dep
    LEFT JOIN marts.v_microfinancieras_historica mfi
        ON mfi.periodo = dep.periodo AND mfi.nomb_correg = dep.nomb_correg
),
totales AS (
    SELECT periodo, SUM(depositos_total) AS total_smf FROM base
    WHERE COALESCE(es_microfinanciera, FALSE) = TRUE
    GROUP BY periodo
)
SELECT
    b.periodo, b.nomb_correg,
    COALESCE(b.es_microfinanciera, FALSE) AS es_smf,
    CASE WHEN COALESCE(b.es_microfinanciera, FALSE) AND t.total_smf > 0
         THEN ROUND((b.depositos_total / t.total_smf)::numeric, 6)
         ELSE 0 END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;


CREATE OR REPLACE VIEW marts.v_kpis_anuales_historica AS
SELECT
    e.periodo,
    dw.raw_to_vigente(e.nomb_correg, e.periodo) AS nomb_correg,
    -- TTM cuentas ER
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_17')   AS utilidad_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_1')    AS cta_1_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_2')    AS cta_2_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_6')    AS cta_6_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_7')    AS cta_7_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_1') AS cta_10_1_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_2') AS cta_10_2_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_3') AS cta_10_3_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_10_4') AS cta_10_4_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_12_7') AS cta_12_7_ttm,
    marts.ttm_resultados(e.periodo, e.nomb_correg, 'TOTAL', 'cta_12_8') AS cta_12_8_ttm,
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_a') AS activos_prom_12m,
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_c') AS patrimonio_prom_12m
FROM (
    SELECT DISTINCT periodo, nomb_correg
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
) e;
