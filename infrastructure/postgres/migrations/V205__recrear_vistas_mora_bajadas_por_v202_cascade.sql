-- =========================================================================
-- V205: Recrear vistas de mora/venta-cartera bajadas por V202 CASCADE
--
-- V202 hizo DROP MATERIALIZED VIEW marts.mv_eeff_resultados_ancho CASCADE.
-- El CASCADE silenciosamente eliminó toda la cadena dependiente:
--
--   v_er4_mes_historica
--   v_venta_cartera_mes_historica
--   v_venta_cartera_mes          (V166: consolida desde historica)
--   v_venta_cartera_12m
--   v_venta_cartera_12m_historica
--   v_mora_global_por_entidad    <-- crítico: getCuadroResumenRaw lo consulta
--   mv_mora_global_historica     (MV WITH NO DATA + indexes)
--   v_mora_global_historica      (passthrough wrapper)
--
-- V204 solo recreó mv_eeff_ratios. Esta migración recupera el resto.
--
-- Orden: de la base hacia arriba (cada objeto crea antes que sus dependientes).
-- =========================================================================

-- ---- 1. v_er4_mes_historica ------------------------------------------------
DROP VIEW IF EXISTS marts.v_er4_mes_historica CASCADE;
CREATE VIEW marts.v_er4_mes_historica AS
WITH ytd AS (
    SELECT e.periodo,
           dw.raw_to_vigente(e.nomb_correg, e.periodo) AS nomb_correg,
           SUM(e.cta_4) AS er4_ytd
    FROM marts.mv_eeff_resultados_ancho e
    WHERE e.moneda = 'TOTAL' AND e.nomb_correg IS NOT NULL
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


-- ---- 2. v_venta_cartera_mes_historica --------------------------------------
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


-- ---- 3. v_venta_cartera_mes  (V166: agrega desde historica por canonico) ---
-- CREATE OR REPLACE porque puede existir como stub en alguna sesion de fix
CREATE OR REPLACE VIEW marts.v_venta_cartera_mes AS
SELECT
    h.periodo,
    dw.resolver_nomb_correg_canonico(h.nomb_correg) AS nomb_correg,
    SUM(h.venta_cartera_mes) AS venta_cartera_mes
FROM marts.v_venta_cartera_mes_historica h
WHERE dw.resolver_nomb_correg_canonico(h.nomb_correg) IS NOT NULL
GROUP BY h.periodo, dw.resolver_nomb_correg_canonico(h.nomb_correg);

COMMENT ON VIEW marts.v_venta_cartera_mes IS
    'Venta de cartera mensual consolidada por canonico (V166 fix 2026-08-11). '
    'Suma valores reales de v_venta_cartera_mes_historica. Recreada en V205 '
    'tras drop en cascada de V202.';


-- ---- 4. v_venta_cartera_12m ------------------------------------------------
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


-- ---- 5. v_venta_cartera_12m_historica --------------------------------------
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


-- ---- 6. v_mora_global_por_entidad  (CRITICA para getCuadroResumenRaw) -------
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
    'MG = (Atrasada+Refin+Castigos12m)/Cartera Bruta. '
    'Recreada en V205 tras drop en cascada de V202.';


-- ---- 7. mv_mora_global_historica  (MV WITH NO DATA + indexes) ---------------
DROP MATERIALIZED VIEW IF EXISTS marts.mv_mora_global_historica CASCADE;
CREATE MATERIALIZED VIEW marts.mv_mora_global_historica AS
SELECT
    col.periodo,
    col.nomb_correg,
    col.cartera_bruta,
    col.cartera_atrasada,
    col.cartera_refin,
    COALESCE(cas.castigos_12m, 0::numeric)        AS castigos_12m,
    COALESCE(vc.venta_cartera_12m, 0::numeric)    AS venta_cartera_12m,
    CASE
        WHEN col.cartera_bruta > 0
        THEN ROUND(
            (col.cartera_atrasada + col.cartera_refin + COALESCE(cas.castigos_12m, 0))
            / col.cartera_bruta, 6
        )
        ELSE NULL
    END AS pct_mora_global,
    CASE
        WHEN col.cartera_bruta > 0
        THEN ROUND(
            (col.cartera_atrasada + col.cartera_refin
             + COALESCE(cas.castigos_12m, 0)
             + COALESCE(vc.venta_cartera_12m, 0))
            / col.cartera_bruta, 6
        )
        ELSE NULL
    END AS pct_mora_global_vc
FROM marts.v_cartera_balance_historica col
LEFT JOIN marts.v_castigos_12m_historica cas
    ON cas.periodo = col.periodo AND cas.nomb_correg = col.nomb_correg
LEFT JOIN marts.v_venta_cartera_12m_historica vc
    ON vc.periodo = col.periodo AND vc.nomb_correg = col.nomb_correg
WITH NO DATA;

CREATE UNIQUE INDEX idx_mv_mora_global_uniq
    ON marts.mv_mora_global_historica (periodo, nomb_correg);
CREATE INDEX idx_mv_mora_global_periodo
    ON marts.mv_mora_global_historica (periodo);
CREATE INDEX idx_mv_mora_global_nomb
    ON marts.mv_mora_global_historica (nomb_correg);

COMMENT ON MATERIALIZED VIEW marts.mv_mora_global_historica IS
    'Materializacion de mora global historica. WITH NO DATA tras V205 — '
    'disparar REFRESH via POST /api/v1/admin/refresh-mvs o '
    'SELECT marts.refresh_mvs_informe();';


-- ---- 8. v_mora_global_historica  (passthrough wrapper para la MV) -----------
CREATE OR REPLACE VIEW marts.v_mora_global_historica AS
    SELECT * FROM marts.mv_mora_global_historica;

COMMENT ON VIEW marts.v_mora_global_historica IS
    'Wrapper de mv_mora_global_historica (V128). Recreado en V205.';
