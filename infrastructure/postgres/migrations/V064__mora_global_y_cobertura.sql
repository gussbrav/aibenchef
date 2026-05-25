-- =========================================================================
-- V064: % Mora Global por entidad y periodo, replicando la formula del
-- Excel "Plantilla PTO EQUILIBRIO.xlsx" hoja "Variables CMAQ con IFIS"
-- celda C398.
--
-- Formula original:
--   % Mora Global = (Cartera Atrasada + Cartera Refinanciada + Castigos 12m)
--                 / Cartera Bruta
--
-- Mapeo a nuestros raw:
--   - Cartera Atrasada      = SUM(raw.colocaciones.saldo_atrasado) por entidad/periodo
--   - Cartera Refinanciada  = SUM(raw.colocaciones.saldo_reest_refin) por entidad/periodo
--   - Castigos 12 meses     = SUM(raw.castigos.saldo_castigos) en los ULTIMOS 12 MESES
--                             (el .xls SBS publica flujo mensual, no acumulado)
--   - Cartera Bruta         = SUM(raw.colocaciones.saldo_total) por entidad/periodo
--
-- Las entidades se consolidan via dw.resolver_nomb_correg_canonico para
-- soportar renombres (Compartamos Financiera -> Compartamos Banco, etc).
-- =========================================================================

-- ---------- COLOCACIONES AGREGADAS POR ENTIDAD/PERIODO ----------
CREATE OR REPLACE VIEW marts.v_colocaciones_agregado_entidad AS
SELECT
    c.periodo,
    dw.resolver_nomb_correg_canonico(c.empresa) AS nomb_correg,
    SUM(c.saldo_vigente)     AS cartera_vigente,
    SUM(c.saldo_reest_refin) AS cartera_refin,
    SUM(c.saldo_atrasado)    AS cartera_atrasada,
    SUM(c.saldo_total)       AS cartera_total
FROM raw.colocaciones_observacion c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.saldo_total IS NOT NULL
GROUP BY c.periodo, dw.resolver_nomb_correg_canonico(c.empresa);

COMMENT ON VIEW marts.v_colocaciones_agregado_entidad IS
    'Cartera por entidad/periodo consolidada y agregada por productos. '
    'Suma los componentes vigente/refinanciado/atrasado/total.';


-- ---------- CASTIGOS 12 MESES POR ENTIDAD/PERIODO ----------
-- Suma los castigos de los ultimos 12 meses (incluyendo el periodo actual).
CREATE OR REPLACE VIEW marts.v_castigos_12m_entidad AS
SELECT
    p.periodo,
    p.nomb_correg,
    COALESCE(SUM(c.saldo_castigos), 0) AS castigos_12m
FROM (
    -- Cross product de (periodo unicos) x (entidades unicas)
    SELECT DISTINCT periodo,
           dw.resolver_nomb_correg_canonico(entidad) AS nomb_correg
    FROM raw.castigos_observacion
    WHERE entidad IS NOT NULL
      AND LOWER(TRIM(entidad)) NOT IN ('total general', 'total', '')
) p
LEFT JOIN raw.castigos_observacion c
    ON dw.resolver_nomb_correg_canonico(c.entidad) = p.nomb_correg
   AND c.periodo BETWEEN
        -- 11 meses atras (12 incluido) -- ej. periodo=202303 -> 202204..202303
        (CASE WHEN p.periodo % 100 >= 12 THEN p.periodo - 11
              ELSE (p.periodo / 100 - 1) * 100 + (p.periodo % 100) + 1 END)
        AND p.periodo
GROUP BY p.periodo, p.nomb_correg;

COMMENT ON VIEW marts.v_castigos_12m_entidad IS
    'Castigos acumulados de los ultimos 12 meses (rolling) por entidad y periodo. '
    'raw.castigos contiene flujo mensual (no acumulado SBS), por eso se suma.';


-- ---------- % MORA GLOBAL ----------
CREATE OR REPLACE VIEW marts.v_mora_global_por_entidad AS
SELECT
    col.periodo,
    col.nomb_correg,
    col.cartera_total                              AS cartera_bruta,
    col.cartera_atrasada,
    col.cartera_refin,
    COALESCE(cas.castigos_12m, 0)                  AS castigos_12m,
    CASE
        WHEN col.cartera_total > 0
        THEN ROUND(
            ((col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
             / col.cartera_total)::numeric, 6)
        ELSE NULL
    END AS pct_mora_global
FROM marts.v_colocaciones_agregado_entidad col
LEFT JOIN marts.v_castigos_12m_entidad cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg;

COMMENT ON VIEW marts.v_mora_global_por_entidad IS
    'Mora Global = (Atrasada + Refinanciada + Castigos 12m) / Cartera Bruta. '
    'Replica formula del Excel PTO Equilibrio C398. NULL cuando no hay '
    'cartera (algo asi no deberia pasar en entidades activas).';
