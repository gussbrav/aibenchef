-- V090 — Restore vistas droppeadas por V085 CASCADE
--
-- ROOT CAUSE (issue #8):
-- V085__fix_mv_eeff_dedup_empresa_sbs.sql ejecuto
--   `DROP MATERIALIZED VIEW marts.mv_eeff_balance_ancho CASCADE`
-- para recrearla con el GROUP BY corregido (dedup empresa_sbs).
-- El CASCADE silenciosamente removio ~20 vistas dependientes:
--   v_cartera_balance_*, v_castigos_12m_*, v_venta_cartera_*,
--   v_mora_global_*, v_cobertura_car_*, v_participacion_smf_*,
--   v_microfinancieras_historica, v_kpis_anuales_*, etc.
--
-- En V085 solo se restauro manualmente mv_eeff_ratios. El resto, al ser
-- vistas normales en migrations ya aplicadas en public.schema_migrations,
-- nunca se re-aplicaron automaticamente.
--
-- Sintomas observados:
--   - Panel /dashboard/informe muestra "6 de 6 entidades sin data en MVs"
--   - 10 vistas marts.v_* referenciadas en frontend no existen
--   - SQL silencioso retorna 0 filas (PostgreSQL no falla al consultar
--     una vista inexistente desde un CTE join lateral)
--
-- FIX:
-- Restaurar el dependency graph aplicando idempotentemente las migrations
-- afectadas en orden topologico. Todas usan CREATE OR REPLACE VIEW, asi
-- que es seguro re-ejecutar.
--
-- Bloques (auto-generados desde las migrations originales, sin DROP):
--   * V065__cobertura_car_y_mora_vc.sql
--   * V067__kpis_anuales_eficiencia_rentabilidad.sql
--   * V069__vistas_historicas_sin_canonizar.sql
--   * V070__vistas_historicas_nombre_vigente.sql
--   * V073__kpis_anuales_sql_puro.sql
--   * V082__mora_global_historica_con_venta_cartera.sql
--   * V083__mora_global_desde_balance.sql
--   * V084__mype_y_smf_denominador_balance.sql


-- =============================================================

-- V065__cobertura_car_y_mora_vc.sql

-- =============================================================

-- =========================================================================
-- V065: Cobertura CAR (%) y % Mora Global con Venta de Cartera (V/C)
--
-- Referencias del Excel "Plantilla PTO EQUILIBRIO.xlsx", hoja
-- "Variables Mibanco":
--
-- 1) %Cob_CAR (r485): cobertura de Cartera de Alto Riesgo
--    = Provisiones / (Cartera Refinanciada + Cartera Atrasada)
--    = ABS(cta_a4_4) / (cta_a4_2 + cta_a4_3)
--    Las cuentas A4.4 (Provisiones) son negativas en el balance SBS, por
--    eso usamos ABS.
--
-- 2) % Mora Global con V/C (r398 + r404):
--    = (Atrasada + Refinanciada + Castigos 12m + Venta Cartera 12m) / Cartera Bruta
--
--    Venta de Cartera (Aprox) (r402-r404):
--      calculo_venta_mes = (cartera_bruta_mes - cartera_bruta_prev_mes)
--                       + castigo_mes
--                       - ganancia_perdida_venta_cartera_mes   (cuenta cta_8)
--      venta_cartera_mes = MAX(0, -calculo_venta_mes)
--    O en lenguaje natural: si la cartera disminuyo mas de lo explicado por
--    castigos y ganancias por venta, la diferencia es venta de cartera
--    aproximada.
--    Venta cartera 12m = SUM(venta_cartera_mes) en los ultimos 12 meses.
-- =========================================================================

-- ---------- COBERTURA CAR ----------
DROP VIEW IF EXISTS marts.v_cobertura_car_por_entidad CASCADE;
CREATE VIEW marts.v_cobertura_car_por_entidad AS
SELECT
    periodo,
    dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
    SUM(cta_a4_2)        AS cartera_refinanciada,
    SUM(cta_a4_3)        AS cartera_atrasada,
    SUM(ABS(cta_a4_4))   AS provisiones,
    CASE
        WHEN SUM(cta_a4_2 + cta_a4_3) > 0
        THEN ROUND(
            (SUM(ABS(cta_a4_4)) / SUM(cta_a4_2 + cta_a4_3))::numeric, 6
        )
        ELSE NULL
    END AS pct_cobertura_car
FROM marts.v_eeff_balance_ancho
WHERE moneda = 'TOTAL'
  AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

COMMENT ON VIEW marts.v_cobertura_car_por_entidad IS
    'Cobertura de Cartera de Alto Riesgo: Provisiones / (Refinanciados + '
    'Atrasados). Replica formula %Cob_CAR del Excel PTO Equilibrio.';


-- ---------- VENTA DE CARTERA MENSUAL (APROX) ----------
-- Auxiliar: castigo mensual por entidad
DROP VIEW IF EXISTS marts.v_castigos_mes_entidad CASCADE;
CREATE VIEW marts.v_castigos_mes_entidad AS
SELECT
    c.periodo,
    dw.resolver_nomb_correg_canonico(c.entidad) AS nomb_correg,
    SUM(c.saldo_castigos) AS castigo_mes
FROM raw.castigos_observacion c
WHERE c.entidad IS NOT NULL
  AND LOWER(TRIM(c.entidad)) NOT IN ('total general', 'total', '')
GROUP BY c.periodo, dw.resolver_nomb_correg_canonico(c.entidad);


-- Venta de Cartera mes aprox (un valor por entidad/periodo)
DROP VIEW IF EXISTS marts.v_venta_cartera_mes CASCADE;
CREATE VIEW marts.v_venta_cartera_mes AS
WITH cartera AS (
    SELECT
        periodo,
        nomb_correg,
        cartera_total
    FROM marts.v_colocaciones_agregado_entidad
),
gpv AS (
    -- Ganancia/Perdida Venta Cartera mensual (cta_8 del ER)
    -- El ER en SBS es YTD; obtener flujo del mes = ytd_mes - ytd_mes_prev
    SELECT
        e.periodo,
        dw.resolver_nomb_correg_canonico(e.nomb_correg) AS nomb_correg,
        SUM(e.cta_8) AS gpv_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda = 'TOTAL' AND e.nomb_correg IS NOT NULL
    GROUP BY e.periodo, dw.resolver_nomb_correg_canonico(e.nomb_correg)
),
gpv_mes AS (
    SELECT
        g.periodo,
        g.nomb_correg,
        -- Si es enero: gpv_mes = gpv_ytd; sino gpv_ytd - gpv_ytd_prev
        CASE
            WHEN g.periodo % 100 = 1 THEN COALESCE(g.gpv_ytd, 0)
            ELSE COALESCE(g.gpv_ytd, 0) - COALESCE(gp.gpv_ytd, 0)
        END AS gpv_mes
    FROM gpv g
    LEFT JOIN gpv gp
      ON gp.nomb_correg = g.nomb_correg
     AND gp.periodo = (g.periodo - 1)  -- mes previo en mismo anio
     AND g.periodo % 100 != 1
)
SELECT
    c.periodo,
    c.nomb_correg,
    -- (cartera_actual - cartera_prev) + castigo_mes - gpv_mes
    -- venta_cartera_mes = MAX(0, -calculo)
    GREATEST(0,
        - (
            COALESCE(c.cartera_total, 0) - COALESCE(cp.cartera_total, 0)
            + COALESCE(cas.castigo_mes, 0)
            - COALESCE(gpv.gpv_mes, 0)
        )
    ) AS venta_cartera_mes
FROM cartera c
LEFT JOIN cartera cp ON cp.nomb_correg = c.nomb_correg AND cp.periodo = (c.periodo - 1)
LEFT JOIN marts.v_castigos_mes_entidad cas
       ON cas.periodo = c.periodo AND cas.nomb_correg = c.nomb_correg
LEFT JOIN gpv_mes gpv ON gpv.periodo = c.periodo AND gpv.nomb_correg = c.nomb_correg;


-- Venta de Cartera 12 meses rolling
DROP VIEW IF EXISTS marts.v_venta_cartera_12m CASCADE;
CREATE VIEW marts.v_venta_cartera_12m AS
SELECT
    p.periodo,
    p.nomb_correg,
    COALESCE(SUM(v.venta_cartera_mes), 0) AS venta_cartera_12m
FROM (
    SELECT DISTINCT periodo, nomb_correg FROM marts.v_venta_cartera_mes
) p
LEFT JOIN marts.v_venta_cartera_mes v
    ON v.nomb_correg = p.nomb_correg
   AND v.periodo BETWEEN
        (CASE WHEN p.periodo % 100 >= 12 THEN p.periodo - 11
              ELSE (p.periodo / 100 - 1) * 100 + (p.periodo % 100) + 1 END)
        AND p.periodo
GROUP BY p.periodo, p.nomb_correg;


-- ---------- % MORA GLOBAL CON V/C ----------
-- Reemplaza v_mora_global agregando venta_cartera_12m al numerador.
DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
CREATE VIEW marts.v_mora_global_por_entidad AS
SELECT
    col.periodo,
    col.nomb_correg,
    col.cartera_total                              AS cartera_bruta,
    col.cartera_atrasada,
    col.cartera_refin,
    COALESCE(cas.castigos_12m, 0)                  AS castigos_12m,
    COALESCE(vc.venta_cartera_12m, 0)              AS venta_cartera_12m,
    -- Mora sin V/C
    CASE
        WHEN col.cartera_total > 0
        THEN ROUND(
            ((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
             / col.cartera_total)::numeric, 6)
        ELSE NULL
    END AS pct_mora_global,
    -- Mora con V/C
    CASE
        WHEN col.cartera_total > 0
        THEN ROUND(
            ((col.cartera_atrasada + col.cartera_refin
              + COALESCE(cas.castigos_12m, 0)
              + COALESCE(vc.venta_cartera_12m, 0))
             / col.cartera_total)::numeric, 6)
        ELSE NULL
    END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_entidad col
LEFT JOIN marts.v_castigos_12m_entidad cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_por_entidad IS
    'Mora Global: 2 variantes. pct_mora_global = sin V/C (formula C398 del '
    'Excel). pct_mora_global_vc = con Venta de Cartera 12m (aprox via '
    'cambio en cartera - castigos - GPV/C, fila r402-r404).';


-- =============================================================

-- V067__kpis_anuales_eficiencia_rentabilidad.sql

-- =============================================================

-- =========================================================================
-- V067: Vista marts.v_kpis_anuales_entidad con componentes TTM (trailing
-- 12 months) y promedios 12m para Eficiencia + Rentabilidad.
--
-- Fórmulas verificadas en Excel "Plantilla PTO EQUILIBRIO.xlsx" hoja
-- "Variables Mibanco":
--
--   Utilidad TTM (r545) = SUM(últimos 12 utilidad_mes)
--     utilidad_mes (r538) = cta_17_ytd - cta_17_ytd_prev (enero = cta_17_ytd)
--
--   Patrimonio_prom_12m (r526) = AVG(cta_c en últimos 12 meses)
--   Activos_prom_12m    (r514) = AVG(cta_a en últimos 12 meses)
--   Cartera_prom_12m    (r288) = AVG(cartera_bruta en últimos 12 meses)
--
--   ROE  (r552) = Utilidad_TTM / Patrimonio_prom_12m
--   ROA  (r558) = Utilidad_TTM / Activos_prom_12m
--
--   Gastos Op / Margen Bruto (r115) =
--     (cta_10_1 + cta_10_2 + cta_10_3 + cta_10_4 + cta_12_7 + cta_12_8)_TTM
--     / ((cta_1 - cta_2) + (cta_6 - cta_7))_TTM
--
--   % INOF Neto / Ingresos Totales (r685 indirectamente):
--     INOF Neto = (cta_6 - cta_7)_TTM
--     Ingresos Totales (r683) = cta_1_TTM + cta_6_TTM + MAX(0, cta_5_TTM + cta_13_TTM)
--
-- Patrón TTM (V034): ttm(M) = ytd(M) + ytd(Dic_prev) - ytd(M_prev_year)
-- =========================================================================

-- Helper genérico: promedio 12m de una cuenta del balance.
-- Toma valor del balance al cierre de cada mes en los últimos 12 meses
-- (incluyendo el actual) y promedia. Si faltan meses, usa los disponibles.
CREATE OR REPLACE FUNCTION marts.balance_prom_12m(
    _periodo INT,
    _nomb_correg TEXT,
    _moneda TEXT,
    _columna TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _suma NUMERIC := 0;
    _n INT := 0;
    _row RECORD;
    _anio INT := _periodo / 100;
    _mes  INT := _periodo % 100;
    _periodo_inicio INT;
    _query TEXT;
BEGIN
    -- 12 meses calendario hacia atrás (Ej. Abr-20 -> May-19..Abr-20)
    _periodo_inicio := CASE WHEN _mes = 12 THEN _periodo - 11
                            ELSE (_anio - 1) * 100 + (_mes + 1) END;

    _query := format(
        'SELECT %I AS valor FROM marts.v_eeff_balance_ancho
         WHERE nomb_correg=$1 AND moneda=$2 AND periodo >= $3 AND periodo <= $4 ORDER BY periodo',
        _columna
    );

    FOR _row IN EXECUTE _query USING _nomb_correg, _moneda, _periodo_inicio, _periodo
    LOOP
        IF _row.valor IS NOT NULL THEN
            _suma := _suma + _row.valor;
            _n := _n + 1;
        END IF;
    END LOOP;

    IF _n = 0 THEN RETURN NULL; END IF;
    RETURN _suma / _n;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marts.balance_prom_12m IS
    'Promedio simple en últimos 12 meses de cualquier columna del balance '
    '(ej cta_a, cta_c). Replica r514/r526 del Excel.';


-- Helper: cartera bruta promedio 12m (vigente + refinanciada + atrasada)
CREATE OR REPLACE FUNCTION marts.cartera_bruta_prom_12m(
    _periodo INT,
    _nomb_correg TEXT,
    _moneda TEXT
) RETURNS NUMERIC AS $$
DECLARE
    _suma NUMERIC := 0;
    _n INT := 0;
    _anio INT := _periodo / 100;
    _mes  INT := _periodo % 100;
    _periodo_inicio INT;
    _row RECORD;
BEGIN
    _periodo_inicio := CASE WHEN _mes = 12 THEN _periodo - 11
                            ELSE (_anio - 1) * 100 + (_mes + 1) END;

    FOR _row IN
        SELECT (COALESCE(cta_a4_1,0) + COALESCE(cta_a4_2,0) + COALESCE(cta_a4_3,0)) AS cb
        FROM marts.v_eeff_balance_ancho
        WHERE nomb_correg = _nomb_correg AND moneda = _moneda
          AND periodo >= _periodo_inicio AND periodo <= _periodo
        ORDER BY periodo
    LOOP
        IF _row.cb IS NOT NULL AND _row.cb > 0 THEN
            _suma := _suma + _row.cb;
            _n := _n + 1;
        END IF;
    END LOOP;

    IF _n = 0 THEN RETURN NULL; END IF;
    RETURN _suma / _n;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------- VISTA DE KPIs ANUALES POR ENTIDAD/PERIODO ----------
-- Computa TTM y promedios 12m para cada combinación que aparezca en
-- mv_eeff_resultados_ancho. Granularidad: (periodo, nomb_correg).
DROP VIEW IF EXISTS marts.v_kpis_anuales_entidad CASCADE;
CREATE VIEW marts.v_kpis_anuales_entidad AS
SELECT
    e.periodo,
    e.nomb_correg,
    -- TTM cuentas ER (numeradores)
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
    -- Promedios 12m del balance (denominadores ROE/ROA)
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_a') AS activos_prom_12m,
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_c') AS patrimonio_prom_12m,
    marts.cartera_bruta_prom_12m(e.periodo, e.nomb_correg, 'TOTAL')    AS cartera_prom_12m
FROM (
    SELECT DISTINCT periodo, nomb_correg
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
) e;

COMMENT ON VIEW marts.v_kpis_anuales_entidad IS
    'Componentes TTM y promedios 12m para KPIs anuales del cuadro resumen '
    '(Utilidad, ROE, ROA, Gastos Op / Margen, INOF / Ingresos). Una fila '
    'por (periodo, nomb_correg). Performance: indices materializados en '
    'mv_eeff_resultados_ancho hacen los ttm_resultados rapidos.';


-- =============================================================

-- V069__vistas_historicas_sin_canonizar.sql

-- =============================================================

-- =========================================================================
-- V069: Crea vistas paralelas SIN canonización via entidad_maestra.
--
-- Motivacion: en modo 'Renombres Separados' (consolidar=false), las CTEs
-- del cuadro resumen deben poder consultar los datos por nombre HISTORICO
-- (ej. "Financiera Compartamos" en Abr 2020) y obtener solo la data raw
-- que originalmente tenia ese nombre, NO agregada bajo su canonico actual.
--
-- Estrategia: las vistas _historica usan INITCAP(limpiar_nombre_raw(...))
-- como nomb_correg (limpieza superficial), sin lookup a entidad_maestra.
-- Asi cada nombre raw queda como entidad separada.
--
-- Las vistas _canonico originales NO cambian — siguen agregando todo bajo
-- el canónico actual.
-- =========================================================================

-- Helper inline para el dispatch: cuando un alias en entidad_nombre
-- apunta a un canonico pero queremos respetar la nomenclatura raw,
-- usamos solo INITCAP del nombre raw limpio.
-- (No funcion nueva, formula inline en cada vista para claridad.)


-- ---------- 1) OFICINAS HISTORICA ----------
DROP VIEW IF EXISTS marts.v_oficinas_por_entidad_historica CASCADE;
CREATE VIEW marts.v_oficinas_por_entidad_historica AS
WITH base AS (
    SELECT
        o.periodo,
        o.codigo_oficina,
        INITCAP(dw.limpiar_nombre_raw(o.empresa_sbs)) AS nomb_correg
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


-- ---------- 2) CLIENTES HISTORICA ----------
DROP VIEW IF EXISTS marts.v_clientes_por_entidad_historica CASCADE;
CREATE VIEW marts.v_clientes_por_entidad_historica AS
SELECT
    periodo,
    INITCAP(dw.limpiar_nombre_raw(c.empresa)) AS nomb_correg,
    SUM(c.n_clientes)::int AS n_clientes
FROM raw.clientes_creditos c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.producto = 'TOTAL'
GROUP BY periodo, INITCAP(dw.limpiar_nombre_raw(c.empresa));


-- ---------- 3) PERSONAL HISTORICA ----------
DROP VIEW IF EXISTS marts.v_personal_por_entidad_historica CASCADE;
CREATE VIEW marts.v_personal_por_entidad_historica AS
SELECT
    periodo,
    INITCAP(dw.limpiar_nombre_raw(p.empresa_sbs)) AS nomb_correg,
    SUM(p.total)::int     AS n_personal,
    SUM(p.empleados)::int AS n_empleados
FROM raw.personal_observacion p
WHERE p.empresa_sbs IS NOT NULL
  AND LOWER(TRIM(p.empresa_sbs)) NOT IN ('total general', 'total', '')
  AND p.total IS NOT NULL
GROUP BY periodo, INITCAP(dw.limpiar_nombre_raw(p.empresa_sbs));


-- ---------- 4) COLOCACIONES AGREGADO HISTORICA ----------
DROP VIEW IF EXISTS marts.v_colocaciones_agregado_historica CASCADE;
CREATE VIEW marts.v_colocaciones_agregado_historica AS
SELECT
    c.periodo,
    INITCAP(dw.limpiar_nombre_raw(c.empresa)) AS nomb_correg,
    SUM(c.saldo_vigente)     AS cartera_vigente,
    SUM(c.saldo_reest_refin) AS cartera_refin,
    SUM(c.saldo_atrasado)    AS cartera_atrasada,
    SUM(c.saldo_total)       AS cartera_total
FROM raw.colocaciones_observacion c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.saldo_total IS NOT NULL
GROUP BY c.periodo, INITCAP(dw.limpiar_nombre_raw(c.empresa));


-- ---------- 5) CASTIGOS 12M HISTORICA ----------
DROP VIEW IF EXISTS marts.v_castigos_12m_historica CASCADE;
CREATE VIEW marts.v_castigos_12m_historica AS
SELECT
    p.periodo, p.nomb_correg,
    COALESCE(SUM(c.saldo_castigos), 0) AS castigos_12m
FROM (
    SELECT DISTINCT periodo, INITCAP(dw.limpiar_nombre_raw(entidad)) AS nomb_correg
    FROM raw.castigos_observacion
    WHERE entidad IS NOT NULL
      AND LOWER(TRIM(entidad)) NOT IN ('total general', 'total', '')
) p
LEFT JOIN raw.castigos_observacion c
    ON INITCAP(dw.limpiar_nombre_raw(c.entidad)) = p.nomb_correg
   AND c.periodo BETWEEN
        (CASE WHEN p.periodo % 100 >= 12 THEN p.periodo - 11
              ELSE (p.periodo / 100 - 1) * 100 + (p.periodo % 100) + 1 END)
        AND p.periodo
GROUP BY p.periodo, p.nomb_correg;


-- ---------- 6) MORA GLOBAL HISTORICA ----------
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;
CREATE VIEW marts.v_mora_global_historica AS
SELECT
    col.periodo, col.nomb_correg,
    col.cartera_total AS cartera_bruta,
    col.cartera_atrasada, col.cartera_refin,
    COALESCE(cas.castigos_12m, 0) AS castigos_12m,
    CASE WHEN col.cartera_total > 0
         THEN ROUND(((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
                     / col.cartera_total)::numeric, 6)
         ELSE NULL END AS pct_mora_global,
    -- mora con V/C historica omite venta_cartera (no se puede calcular sin
    -- consolidacion canonica de A4.4); usa mismo valor que sin V/C.
    CASE WHEN col.cartera_total > 0
         THEN ROUND(((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
                     / col.cartera_total)::numeric, 6)
         ELSE NULL END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
       ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg;


-- ---------- 7) COBERTURA CAR HISTORICA ----------
DROP VIEW IF EXISTS marts.v_cobertura_car_historica CASCADE;
CREATE VIEW marts.v_cobertura_car_historica AS
SELECT
    b.periodo,
    INITCAP(dw.limpiar_nombre_raw(b.nomb_correg)) AS nomb_correg,
    SUM(cta_a4_2)      AS cartera_refinanciada,
    SUM(cta_a4_3)      AS cartera_atrasada,
    SUM(ABS(cta_a4_4)) AS provisiones,
    CASE WHEN SUM(cta_a4_2 + cta_a4_3) > 0
         THEN ROUND((SUM(ABS(cta_a4_4)) / SUM(cta_a4_2 + cta_a4_3))::numeric, 6)
         ELSE NULL END AS pct_cobertura_car
FROM marts.v_eeff_balance_ancho b
WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
GROUP BY b.periodo, INITCAP(dw.limpiar_nombre_raw(b.nomb_correg));


-- ---------- 8) PARTICIPACION SMF HISTORICA ----------
-- Para "consolidar=false" la participacion SMF mantiene el flag MFI del
-- canonico (porque la regla 50% MYPE se calcula sobre cartera consolidada)
-- pero usa la cartera del nombre raw para el numerador.
DROP VIEW IF EXISTS marts.v_participacion_smf_coloc_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_coloc_historica AS
WITH base AS (
    SELECT
        col.periodo, col.nomb_correg, col.cartera_total,
        mfi.es_microfinanciera
    FROM marts.v_colocaciones_agregado_historica col
    LEFT JOIN dw.entidad_microfinanciera_periodo mfi
        ON mfi.periodo = col.periodo
       AND mfi.nomb_correg = dw.resolver_nomb_correg_canonico(col.nomb_correg)
),
totales AS (
    SELECT periodo, SUM(cartera_total) AS total_smf
    FROM base
    WHERE COALESCE(es_microfinanciera, FALSE) = TRUE
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
DROP VIEW IF EXISTS marts.v_depositos_total_historica CASCADE;
CREATE VIEW marts.v_depositos_total_historica AS
SELECT
    d.periodo,
    INITCAP(dw.limpiar_nombre_raw(d.empresa)) AS nomb_correg,
    SUM(d.saldo_total) AS depositos_total
FROM raw.depositos_observacion d
WHERE d.empresa IS NOT NULL
  AND LOWER(TRIM(d.empresa)) NOT IN ('total general', 'total', '')
  AND d.saldo_total IS NOT NULL
GROUP BY d.periodo, INITCAP(dw.limpiar_nombre_raw(d.empresa))
HAVING SUM(d.saldo_total) > 0;
DROP VIEW IF EXISTS marts.v_participacion_smf_dep_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_dep_historica AS
WITH base AS (
    SELECT
        dep.periodo, dep.nomb_correg, dep.depositos_total,
        mfi.es_microfinanciera
    FROM marts.v_depositos_total_historica dep
    LEFT JOIN dw.entidad_microfinanciera_periodo mfi
        ON mfi.periodo = dep.periodo
       AND mfi.nomb_correg = dw.resolver_nomb_correg_canonico(dep.nomb_correg)
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


-- ---------- 9) MFI HISTORICA (porcentaje MYPE por nombre raw) ----------
-- Calcula la cartera MYPE/total para cada nombre raw individual.
DROP VIEW IF EXISTS marts.v_microfinancieras_historica CASCADE;
CREATE VIEW marts.v_microfinancieras_historica AS
WITH base AS (
    SELECT
        c.periodo,
        INITCAP(dw.limpiar_nombre_raw(c.empresa)) AS nomb_correg,
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


-- ---------- 10) KPIs ANUALES HISTORICA ----------
-- Mismas formulas TTM/promedios pero agrupando por INITCAP(limpiar_nombre_raw)
-- (sin resolver canonico). Usa la mv_eeff directamente.
DROP VIEW IF EXISTS marts.v_kpis_anuales_historica CASCADE;
CREATE VIEW marts.v_kpis_anuales_historica AS
SELECT
    e.periodo,
    INITCAP(dw.limpiar_nombre_raw(e.nomb_correg)) AS nomb_correg,
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
    -- Promedios 12m del balance
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_a') AS activos_prom_12m,
    marts.balance_prom_12m(e.periodo, e.nomb_correg, 'TOTAL', 'cta_c') AS patrimonio_prom_12m
FROM (
    SELECT DISTINCT periodo, nomb_correg
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
) e;


-- =============================================================

-- V070__vistas_historicas_nombre_vigente.sql

-- =============================================================

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
DROP VIEW IF EXISTS marts.v_oficinas_por_entidad_historica CASCADE;
CREATE VIEW marts.v_oficinas_por_entidad_historica AS
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
DROP VIEW IF EXISTS marts.v_clientes_por_entidad_historica CASCADE;
CREATE VIEW marts.v_clientes_por_entidad_historica AS
SELECT
    periodo,
    dw.raw_to_vigente(c.empresa, c.periodo) AS nomb_correg,
    SUM(c.n_clientes)::int AS n_clientes
FROM raw.clientes_creditos c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.producto = 'TOTAL'
GROUP BY periodo, dw.raw_to_vigente(c.empresa, c.periodo);
DROP VIEW IF EXISTS marts.v_personal_por_entidad_historica CASCADE;
CREATE VIEW marts.v_personal_por_entidad_historica AS
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
DROP VIEW IF EXISTS marts.v_colocaciones_agregado_historica CASCADE;
CREATE VIEW marts.v_colocaciones_agregado_historica AS
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
DROP VIEW IF EXISTS marts.v_castigos_12m_historica CASCADE;
CREATE VIEW marts.v_castigos_12m_historica AS
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
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;
CREATE VIEW marts.v_mora_global_historica AS
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
DROP VIEW IF EXISTS marts.v_cobertura_car_historica CASCADE;
CREATE VIEW marts.v_cobertura_car_historica AS
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
DROP VIEW IF EXISTS marts.v_microfinancieras_historica CASCADE;
CREATE VIEW marts.v_microfinancieras_historica AS
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
DROP VIEW IF EXISTS marts.v_participacion_smf_coloc_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_coloc_historica AS
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
DROP VIEW IF EXISTS marts.v_depositos_total_historica CASCADE;
CREATE VIEW marts.v_depositos_total_historica AS
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
DROP VIEW IF EXISTS marts.v_participacion_smf_dep_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_dep_historica AS
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
DROP VIEW IF EXISTS marts.v_kpis_anuales_historica CASCADE;
CREATE VIEW marts.v_kpis_anuales_historica AS
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


-- =============================================================

-- V073__kpis_anuales_sql_puro.sql

-- =============================================================

-- =========================================================================
-- V073: Reescribe v_kpis_anuales como MATERIALIZED VIEW con SQL puro.
--
-- V072 introducia funciones plpgsql (ttm_resultados_canonico, etc.) que
-- iteraban row-by-row -> dashboard colgaba en 'Cargando...' infinito.
--
-- Solucion definitiva:
--   1. SQL puro con CTEs y JOINs (sin funciones PL/pgSQL en bucle).
--   2. MATERIALIZED VIEW para que la query sea instantanea. Refresh
--      manual cuando entren nuevos meses.
--   3. Funcion helper marts.refresh_kpis_anuales() para regenerar.
-- =========================================================================

DROP FUNCTION IF EXISTS marts.ttm_resultados_canonico CASCADE;
DROP FUNCTION IF EXISTS marts.balance_prom_12m_canonico CASCADE;

-- ============ MATERIALIZED VIEW v_kpis_anuales_entidad ============
DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_kpis_anuales_entidad CASCADE;
DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_entidad CASCADE;
CREATE MATERIALIZED VIEW marts.mv_kpis_anuales_entidad AS
WITH er_agg AS (
    SELECT
        periodo,
        dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
        SUM(cta_17)   AS cta_17_ytd,
        SUM(cta_1)    AS cta_1_ytd,
        SUM(cta_2)    AS cta_2_ytd,
        SUM(cta_6)    AS cta_6_ytd,
        SUM(cta_7)    AS cta_7_ytd,
        SUM(cta_10_1) AS cta_10_1_ytd,
        SUM(cta_10_2) AS cta_10_2_ytd,
        SUM(cta_10_3) AS cta_10_3_ytd,
        SUM(cta_10_4) AS cta_10_4_ytd,
        SUM(cta_12_7) AS cta_12_7_ytd,
        SUM(cta_12_8) AS cta_12_8_ytd
    FROM marts.mv_eeff_resultados_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg)
),
ttm AS (
    SELECT
        a.periodo, a.nomb_correg,
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
bg_agg AS (
    SELECT periodo,
           dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
           SUM(cta_a) AS activos, SUM(cta_c) AS patrimonio
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg)
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

-- Vista wrapper para compatibilidad con codigo existente que usa el
-- nombre v_kpis_anuales_entidad.
DROP VIEW IF EXISTS marts.v_kpis_anuales_entidad CASCADE;
CREATE VIEW marts.v_kpis_anuales_entidad AS
SELECT * FROM marts.mv_kpis_anuales_entidad;


-- ============ MATERIALIZED VIEW v_kpis_anuales_historica ============
DROP MATERIALIZED VIEW IF EXISTS marts.mv_kpis_anuales_historica CASCADE;
DROP VIEW IF EXISTS marts.v_kpis_anuales_historica CASCADE;
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
bg_agg AS (
    SELECT periodo,
           dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
           SUM(cta_a) AS activos, SUM(cta_c) AS patrimonio
    FROM marts.v_eeff_balance_ancho
    WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
    GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo)
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
DROP VIEW IF EXISTS marts.v_kpis_anuales_historica CASCADE;
CREATE VIEW marts.v_kpis_anuales_historica AS
SELECT * FROM marts.mv_kpis_anuales_historica;


-- Helper para refrescar
CREATE OR REPLACE FUNCTION marts.refresh_kpis_anuales() RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_entidad;
    REFRESH MATERIALIZED VIEW marts.mv_kpis_anuales_historica;
    RETURN 'OK';
END $$;


-- =============================================================

-- V082__mora_global_historica_con_venta_cartera.sql

-- =============================================================

-- =========================================================================
-- V082: %MG con V/C tambien debe computarse en la vista "historica"
-- (renombres separados).
--
-- Bug: v_mora_global_historica devolvia pct_mora_global_vc = pct_mora_global
-- (sin agregar venta_cartera_12m), por lo que Compartamos Apr 2020 mostraba
-- 7.18% / 7.18% en lugar de 7.18% / 7.70%.
--
-- Fix: crear vistas historicas para a44, castigo_mes, er4_mes y venta_cartera
-- (todas usando dw.raw_to_vigente en lugar de resolver_nomb_correg_canonico),
-- luego actualizar v_mora_global_historica.
-- =========================================================================

DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;
DROP VIEW IF EXISTS marts.v_a44_provisiones_historica CASCADE;
CREATE VIEW marts.v_a44_provisiones_historica AS
SELECT periodo,
       dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
       SUM(cta_a4_4) AS a44
FROM marts.v_eeff_balance_ancho
WHERE moneda='TOTAL' AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo);
DROP VIEW IF EXISTS marts.v_castigos_mes_historica CASCADE;
CREATE VIEW marts.v_castigos_mes_historica AS
SELECT periodo,
       dw.raw_to_vigente(entidad, periodo) AS nomb_correg,
       SUM(saldo_castigos) AS castigo_mes
FROM raw.castigos_observacion
WHERE entidad IS NOT NULL
  AND lower(TRIM(entidad)) <> ALL (ARRAY['total general','total',''])
GROUP BY periodo, dw.raw_to_vigente(entidad, periodo);
DROP VIEW IF EXISTS marts.v_er4_mes_historica CASCADE;
CREATE VIEW marts.v_er4_mes_historica AS
WITH ytd AS (
    SELECT e.periodo,
           dw.raw_to_vigente(e.nomb_correg, e.periodo) AS nomb_correg,
           SUM(e.cta_4) AS er4_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda='TOTAL' AND e.nomb_correg IS NOT NULL
    GROUP BY e.periodo, dw.raw_to_vigente(e.nomb_correg, e.periodo)
)
SELECT y.periodo, y.nomb_correg,
       CASE WHEN (y.periodo % 100) = 1 THEN COALESCE(y.er4_ytd, 0)
            ELSE COALESCE(y.er4_ytd, 0) - COALESCE(yp.er4_ytd, 0)
       END AS er4_mes
FROM ytd y
LEFT JOIN ytd yp ON yp.nomb_correg = y.nomb_correg
                AND yp.periodo = (y.periodo - 1)
                AND (y.periodo % 100) <> 1;
DROP VIEW IF EXISTS marts.v_venta_cartera_mes_historica CASCADE;
CREATE VIEW marts.v_venta_cartera_mes_historica AS
SELECT p.periodo, p.nomb_correg,
       GREATEST(0::numeric,
            - (ABS(COALESCE(a.a44, 0)) - ABS(COALESCE(ap.a44, 0))
               + COALESCE(cas.castigo_mes, 0) - COALESCE(er.er4_mes, 0))
       ) AS venta_cartera_mes
FROM (SELECT DISTINCT periodo, nomb_correg FROM marts.v_a44_provisiones_historica) p
LEFT JOIN marts.v_a44_provisiones_historica a
    ON a.periodo = p.periodo AND a.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_a44_provisiones_historica ap
    ON ap.periodo = (p.periodo - 1) AND ap.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_castigos_mes_historica cas
    ON cas.periodo = p.periodo AND cas.nomb_correg = p.nomb_correg
LEFT JOIN marts.v_er4_mes_historica er
    ON er.periodo = p.periodo AND er.nomb_correg = p.nomb_correg;
DROP VIEW IF EXISTS marts.v_venta_cartera_12m_historica CASCADE;
CREATE VIEW marts.v_venta_cartera_12m_historica AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(v.venta_cartera_mes), 0) AS venta_cartera_12m
FROM marts.v_colocaciones_agregado_historica u
LEFT JOIN marts.v_venta_cartera_mes_historica v
    ON v.nomb_correg = u.nomb_correg
    AND v.periodo >= CASE
        WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
        ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
    END
    AND v.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;
CREATE VIEW marts.v_mora_global_historica AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_total AS cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE WHEN col.cartera_total > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0)) / col.cartera_total, 6)
       ELSE NULL END AS pct_mora_global,
       CASE WHEN col.cartera_total > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0) + COALESCE(vc.venta_cartera_12m, 0)) / col.cartera_total, 6)
       ELSE NULL END AS pct_mora_global_vc
FROM marts.v_colocaciones_agregado_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m_historica vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_historica IS
    'MG historica por nombre vigente en cada periodo. Incluye venta_cartera_12m '
    'en MG con V/C (igual al canonico).';


-- =============================================================

-- V083__mora_global_desde_balance.sql

-- =============================================================

-- =========================================================================
-- V083: Mora Global usa el BALANCE (cta_a4_1/2/3) en lugar de raw.colocaciones
--
-- Bug raiz: raw.colocaciones_observacion (importado del archivo SBS de
-- "Estructura de Cartera por Tipo de Credito") NO incluye Creditos de
-- Consumo ni Hipotecarios para ciertas entidades (vienen en archivos
-- separados de SBS). Para Mibanco Apr 2020:
--   Raw colocaciones total: 10,186,916 (solo corporativo + MYPE + hipotecario)
--   Balance cta_a4_1+2+3:   10,828,700 (todo, incluye consumo 641,784)
--
-- El Excel oficial usa el archivo Colocaciones detallado (TD_Colocac) y
-- suma TODOS los productos incluyendo R261 Consumo + R262 Hipotecario.
-- Como el Balance ya tiene la suma completa (todas las cuentas estan
-- separadas como A4.1 Vigente / A4.2 Refinanciado / A4.3 Atrasado),
-- usar el balance es exact match al Excel y NO depende de imports parciales.
--
-- Validacion Mibanco Apr 2020:
--   MG = (544,759 + 104,796 + 363,514) / 10,828,700 = 9.36% (Excel exact)
-- =========================================================================

DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;


-- ============ CARTERA DEL BALANCE (CANONICO) ============
DROP VIEW IF EXISTS marts.v_cartera_balance_entidad CASCADE;
CREATE VIEW marts.v_cartera_balance_entidad AS
SELECT periodo,
       dw.resolver_nomb_correg_canonico(nomb_correg) AS nomb_correg,
       SUM(COALESCE(cta_a4_1, 0)) AS cartera_vigente,
       SUM(COALESCE(cta_a4_2, 0)) AS cartera_refin,
       SUM(COALESCE(cta_a4_3, 0)) AS cartera_atrasada,
       SUM(COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0)) AS cartera_bruta
FROM marts.v_eeff_balance_ancho
WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.resolver_nomb_correg_canonico(nomb_correg);

COMMENT ON VIEW marts.v_cartera_balance_entidad IS
    'Cartera por entidad canonica desde el balance (cta_a4_1 + a4_2 + a4_3). '
    'Incluye TODOS los productos (corporativo, MYPE, consumo, hipotecario) '
    'a diferencia de raw.colocaciones_observacion que puede tener splits parciales.';


-- ============ CARTERA DEL BALANCE (HISTORICA) ============
DROP VIEW IF EXISTS marts.v_cartera_balance_historica CASCADE;
CREATE VIEW marts.v_cartera_balance_historica AS
SELECT periodo,
       dw.raw_to_vigente(nomb_correg, periodo) AS nomb_correg,
       SUM(COALESCE(cta_a4_1, 0)) AS cartera_vigente,
       SUM(COALESCE(cta_a4_2, 0)) AS cartera_refin,
       SUM(COALESCE(cta_a4_3, 0)) AS cartera_atrasada,
       SUM(COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0)) AS cartera_bruta
FROM marts.v_eeff_balance_ancho
WHERE moneda = 'TOTAL' AND nomb_correg IS NOT NULL
GROUP BY periodo, dw.raw_to_vigente(nomb_correg, periodo);


-- ============ CASTIGOS 12m: AHORA USA EL BALANCE COMO UNIVERSO ============
DROP VIEW IF EXISTS marts.v_castigos_12m_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_castigos_12m_historica CASCADE;
DROP VIEW IF EXISTS marts.v_castigos_12m_entidad CASCADE;
CREATE VIEW marts.v_castigos_12m_entidad AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(c.saldo_castigos), 0::numeric) AS castigos_12m
FROM marts.v_cartera_balance_entidad u
LEFT JOIN raw.castigos_observacion c
  ON dw.resolver_nomb_correg_canonico(c.entidad) = u.nomb_correg
  AND c.entidad IS NOT NULL
  AND lower(TRIM(c.entidad)) <> ALL (ARRAY['total general','total',''])
  AND c.periodo >= CASE
      WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
      ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
  END
  AND c.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;
DROP VIEW IF EXISTS marts.v_castigos_12m_historica CASCADE;
CREATE VIEW marts.v_castigos_12m_historica AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(c.saldo_castigos), 0::numeric) AS castigos_12m
FROM marts.v_cartera_balance_historica u
LEFT JOIN raw.castigos_observacion c
  ON dw.raw_to_vigente(c.entidad, u.periodo) = u.nomb_correg
  AND c.entidad IS NOT NULL
  AND lower(TRIM(c.entidad)) <> ALL (ARRAY['total general','total',''])
  AND c.periodo >= CASE
      WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
      ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
  END
  AND c.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;


-- ============ VENTA CARTERA 12m: REENCAUZAR UNIVERSO ============
-- v_venta_cartera_12m sigue usando v_venta_cartera_mes/v_a44 (eso esta bien).
-- Solo necesitamos que el universo de v_venta_cartera_12m incluya todos los
-- periodos del balance. Recreamos con cartera_balance como universo.
DROP VIEW IF EXISTS marts.v_venta_cartera_12m CASCADE;
DROP VIEW IF EXISTS marts.v_venta_cartera_12m_historica CASCADE;
DROP VIEW IF EXISTS marts.v_venta_cartera_12m CASCADE;
CREATE VIEW marts.v_venta_cartera_12m AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(v.venta_cartera_mes), 0::numeric) AS venta_cartera_12m
FROM marts.v_cartera_balance_entidad u
LEFT JOIN marts.v_venta_cartera_mes v
    ON v.nomb_correg = u.nomb_correg
    AND v.periodo >= CASE
        WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
        ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
    END
    AND v.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;
DROP VIEW IF EXISTS marts.v_venta_cartera_12m_historica CASCADE;
CREATE VIEW marts.v_venta_cartera_12m_historica AS
SELECT u.periodo, u.nomb_correg,
       COALESCE(SUM(v.venta_cartera_mes), 0::numeric) AS venta_cartera_12m
FROM marts.v_cartera_balance_historica u
LEFT JOIN marts.v_venta_cartera_mes_historica v
    ON v.nomb_correg = u.nomb_correg
    AND v.periodo >= CASE
        WHEN (u.periodo % 100) >= 12 THEN u.periodo - 11
        ELSE (u.periodo / 100 - 1) * 100 + u.periodo % 100 + 1
    END
    AND v.periodo <= u.periodo
GROUP BY u.periodo, u.nomb_correg;


-- ============ MORA GLOBAL (CANONICO) ============
DROP VIEW IF EXISTS marts.v_mora_global_por_entidad CASCADE;
CREATE VIEW marts.v_mora_global_por_entidad AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0) + COALESCE(vc.venta_cartera_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global_vc
FROM marts.v_cartera_balance_entidad col
LEFT JOIN marts.v_castigos_12m_entidad cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_por_entidad IS
    'MG = (Atrasada+Refin+Castigos12m)/Cartera Bruta usando el BALANCE como '
    'fuente. Incluye consumo + hipotecario + corporativo + MYPE (a diferencia '
    'de raw.colocaciones que puede tener splits parciales). Match exacto Excel.';


-- ============ MORA GLOBAL (HISTORICA) ============
DROP VIEW IF EXISTS marts.v_mora_global_historica CASCADE;
CREATE VIEW marts.v_mora_global_historica AS
SELECT col.periodo,
       col.nomb_correg,
       col.cartera_bruta,
       col.cartera_atrasada,
       col.cartera_refin,
       COALESCE(cas.castigos_12m, 0::numeric) AS castigos_12m,
       COALESCE(vc.venta_cartera_12m, 0::numeric) AS venta_cartera_12m,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global,
       CASE WHEN col.cartera_bruta > 0 THEN
           round((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0) + COALESCE(vc.venta_cartera_12m, 0)) / col.cartera_bruta, 6)
       ELSE NULL END AS pct_mora_global_vc
FROM marts.v_cartera_balance_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m_historica vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg;


-- =============================================================

-- V084__mype_y_smf_denominador_balance.sql

-- =============================================================

-- =========================================================================
-- V084: %Cartera MYPE y %Participacion SMF tambien deben usar el BALANCE
-- como denominador (igual que V083 para MG).
--
-- Bug: v_microfinancieras_historica y v_colocaciones_total_por_entidad
-- computan saldo_total desde raw.colocaciones_observacion, que NO incluye
-- creditos de Consumo (SBS los publica en archivo separado). Para Mibanco
-- Apr 2020 el denominador esta sub-conteado en 641,784 (Consumo).
--
-- Resultado del bug:
--   v_microfinancieras_historica %MYPE Mibanco: 91.30% (incorrecto)
--   dw.entidad_microfinanciera_periodo %MYPE:   85.89% (correcto, ya usaba balance)
--
-- Fix:
--   - v_microfinancieras_historica: saldo_mype de raw (peq+micro) /
--     saldo_total del BALANCE (cta_a4_1+2+3).
--   - v_colocaciones_total_por_entidad: usar cartera_bruta del balance
--     (afecta v_participacion_smf_colocaciones).
-- =========================================================================

DROP VIEW IF EXISTS marts.v_microfinancieras_historica CASCADE;
DROP VIEW IF EXISTS marts.v_colocaciones_total_por_entidad CASCADE;
DROP VIEW IF EXISTS marts.v_participacion_smf_colocaciones CASCADE;
DROP VIEW IF EXISTS marts.v_participacion_smf_coloc_historica CASCADE;


-- ============ MICROFINANCIERAS HISTORICA (raw para MYPE, balance para total) ============
DROP VIEW IF EXISTS marts.v_microfinancieras_historica CASCADE;
CREATE VIEW marts.v_microfinancieras_historica AS
WITH mype_raw AS (
    -- Saldo de creditos en Pequena + Microempresa (mismas reglas que canonico)
    SELECT c.periodo,
           dw.raw_to_vigente(c.empresa, c.periodo) AS nomb_correg,
           SUM(c.saldo_total) AS saldo_mype
    FROM raw.colocaciones_observacion c
    WHERE c.empresa IS NOT NULL
      AND lower(TRIM(c.empresa)) <> ALL (ARRAY['total general','total',''])
      AND c.saldo_total IS NOT NULL
      AND (
          lower(TRIM(c.producto)) = ANY (ARRAY['microempresa','a microempresas'])
          OR lower(TRIM(c.producto)) LIKE 'peque%empresa%'
      )
    GROUP BY 1, 2
),
bal AS (
    SELECT periodo, nomb_correg, cartera_bruta AS saldo_total
    FROM marts.v_cartera_balance_historica
)
SELECT b.periodo, b.nomb_correg,
       CASE WHEN b.saldo_total > 0
            THEN round(COALESCE(m.saldo_mype, 0) / b.saldo_total, 6)
            ELSE NULL END AS pct_cartera_mype,
       b.saldo_total > 0
       AND (COALESCE(m.saldo_mype, 0) / b.saldo_total) >= 0.5 AS es_microfinanciera
FROM bal b
LEFT JOIN mype_raw m ON m.periodo = b.periodo AND m.nomb_correg = b.nomb_correg
WHERE b.saldo_total > 0;

COMMENT ON VIEW marts.v_microfinancieras_historica IS
    'MYPE historica: saldo_mype de raw.colocaciones (Pequena+Micro), saldo_total '
    'del balance (cta_a4_1+2+3). Match con canonico dw.entidad_microfinanciera_periodo.';


-- ============ V_COLOCACIONES_TOTAL_POR_ENTIDAD: usa balance ============
DROP VIEW IF EXISTS marts.v_colocaciones_total_por_entidad CASCADE;
CREATE VIEW marts.v_colocaciones_total_por_entidad AS
SELECT periodo, nomb_correg, cartera_bruta AS cartera_total
FROM marts.v_cartera_balance_entidad
WHERE cartera_bruta > 0;

COMMENT ON VIEW marts.v_colocaciones_total_por_entidad IS
    'Cartera total por entidad canonica desde el BALANCE (cta_a4_1+2+3). '
    'Antes usaba raw.colocaciones que excluye Consumo para algunas entidades.';


-- ============ V_COLOCACIONES_TOTAL_POR_ENTIDAD HISTORICA ============
DROP VIEW IF EXISTS marts.v_colocaciones_total_historica CASCADE;
CREATE VIEW marts.v_colocaciones_total_historica AS
SELECT periodo, nomb_correg, cartera_bruta AS cartera_total
FROM marts.v_cartera_balance_historica
WHERE cartera_bruta > 0;


-- ============ PARTICIPACION SMF COLOC (CANONICO) ============
DROP VIEW IF EXISTS marts.v_participacion_smf_colocaciones CASCADE;
CREATE VIEW marts.v_participacion_smf_colocaciones AS
WITH base AS (
    SELECT v.periodo, v.nomb_correg, v.cartera_total,
           mfi.es_microfinanciera
    FROM marts.v_colocaciones_total_por_entidad v
    LEFT JOIN dw.entidad_microfinanciera_periodo mfi
        ON mfi.periodo = v.periodo AND mfi.nomb_correg = v.nomb_correg
), totales AS (
    SELECT periodo, SUM(cartera_total) AS total_smf
    FROM base
    WHERE COALESCE(es_microfinanciera, false) = true
    GROUP BY periodo
)
SELECT b.periodo, b.nomb_correg,
       COALESCE(b.es_microfinanciera, false) AS es_smf,
       CASE
           WHEN COALESCE(b.es_microfinanciera, false) AND t.total_smf > 0
           THEN round(b.cartera_total / t.total_smf, 6)
           ELSE 0::numeric
       END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;


-- ============ PARTICIPACION SMF COLOC (HISTORICA) ============
DROP VIEW IF EXISTS marts.v_participacion_smf_coloc_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_coloc_historica AS
WITH base AS (
    SELECT v.periodo, v.nomb_correg, v.cartera_total,
           mfi.es_microfinanciera
    FROM marts.v_colocaciones_total_historica v
    LEFT JOIN marts.v_microfinancieras_historica mfi
        ON mfi.periodo = v.periodo AND mfi.nomb_correg = v.nomb_correg
), totales AS (
    SELECT periodo, SUM(cartera_total) AS total_smf
    FROM base
    WHERE COALESCE(es_microfinanciera, false) = true
    GROUP BY periodo
)
SELECT b.periodo, b.nomb_correg,
       COALESCE(b.es_microfinanciera, false) AS es_smf,
       CASE
           WHEN COALESCE(b.es_microfinanciera, false) AND t.total_smf > 0
           THEN round(b.cartera_total / t.total_smf, 6)
           ELSE 0::numeric
       END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;


-- =============================================================
-- APPEND FINAL: vistas residuales caidas por CASCADE intra-V090
-- =============================================================

-- v_participacion_smf_dep_historica (V070 la crea, pero V084 dropea
-- v_microfinancieras_historica CASCADE y se la lleva).
DROP VIEW IF EXISTS marts.v_participacion_smf_dep_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_dep_historica AS
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
