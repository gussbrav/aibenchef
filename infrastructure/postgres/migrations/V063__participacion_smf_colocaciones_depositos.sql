-- =========================================================================
-- V063: Vistas de % participacion en el Sistema Microfinanciero (SMF)
-- por entidad y periodo, para Colocaciones y Depositos.
--
-- Reglas (vinculadas a R14):
--  - Una entidad pertenece al SMF en periodo P si
--    (cartera Pequena Empresa + cartera Microempresa) / cartera total >= 50%.
--    Esa clasificacion vive en dw.entidad_microfinanciera_periodo (V057).
--  - %_participacion_smf de la entidad E en P:
--      Si E es del SMF:    saldo_total_E / SUM(saldo_total de todas las del SMF en P)
--      Si E NO es del SMF: 0 (no participa)
--
-- Aplica para Colocaciones (cartera bruta) y Depositos (saldo total).
-- =========================================================================

-- ---------- COLOCACIONES ----------
-- 1) Resumen de saldo_total por entidad (canonizado, todos los productos sumados)
CREATE OR REPLACE VIEW marts.v_colocaciones_total_por_entidad AS
SELECT
    c.periodo,
    dw.resolver_nomb_correg_canonico(c.empresa) AS nomb_correg,
    SUM(c.saldo_total) AS cartera_total
FROM raw.colocaciones_observacion c
WHERE c.empresa IS NOT NULL
  AND LOWER(TRIM(c.empresa)) NOT IN ('total general', 'total', '')
  AND c.saldo_total IS NOT NULL
GROUP BY c.periodo, dw.resolver_nomb_correg_canonico(c.empresa)
HAVING SUM(c.saldo_total) > 0;

COMMENT ON VIEW marts.v_colocaciones_total_por_entidad IS
    'Cartera total por entidad consolidada (canonico). Suma TODOS los '
    'productos de raw.colocaciones_observacion. Base para % participacion SMF.';


-- 2) % participacion en SMF
CREATE OR REPLACE VIEW marts.v_participacion_smf_colocaciones AS
WITH base AS (
    SELECT
        v.periodo,
        v.nomb_correg,
        v.cartera_total,
        mfi.es_microfinanciera
    FROM marts.v_colocaciones_total_por_entidad v
    LEFT JOIN dw.entidad_microfinanciera_periodo mfi
        ON mfi.periodo = v.periodo AND mfi.nomb_correg = v.nomb_correg
),
totales AS (
    SELECT periodo, SUM(cartera_total) AS total_smf
    FROM base
    WHERE COALESCE(es_microfinanciera, FALSE) = TRUE
    GROUP BY periodo
)
SELECT
    b.periodo,
    b.nomb_correg,
    COALESCE(b.es_microfinanciera, FALSE) AS es_smf,
    CASE
        WHEN COALESCE(b.es_microfinanciera, FALSE) AND t.total_smf > 0
        THEN ROUND((b.cartera_total / t.total_smf)::numeric, 6)
        ELSE 0
    END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;

COMMENT ON VIEW marts.v_participacion_smf_colocaciones IS
    'Para cada (periodo, entidad), el % de participacion en el total de '
    'cartera del SMF. 0 si la entidad NO es SMF en ese periodo.';


-- ---------- DEPOSITOS ----------
CREATE OR REPLACE VIEW marts.v_depositos_total_por_entidad AS
SELECT
    d.periodo,
    dw.resolver_nomb_correg_canonico(d.empresa) AS nomb_correg,
    SUM(d.saldo_total) AS depositos_total
FROM raw.depositos_observacion d
WHERE d.empresa IS NOT NULL
  AND LOWER(TRIM(d.empresa)) NOT IN ('total general', 'total', '')
  AND d.saldo_total IS NOT NULL
GROUP BY d.periodo, dw.resolver_nomb_correg_canonico(d.empresa)
HAVING SUM(d.saldo_total) > 0;

COMMENT ON VIEW marts.v_depositos_total_por_entidad IS
    'Deposito total por entidad consolidada (canonico). Suma todos los '
    'productos de raw.depositos_observacion (Ahorro, Plazo, Vista, CTS).';


CREATE OR REPLACE VIEW marts.v_participacion_smf_depositos AS
WITH base AS (
    SELECT
        v.periodo,
        v.nomb_correg,
        v.depositos_total,
        mfi.es_microfinanciera
    FROM marts.v_depositos_total_por_entidad v
    LEFT JOIN dw.entidad_microfinanciera_periodo mfi
        ON mfi.periodo = v.periodo AND mfi.nomb_correg = v.nomb_correg
),
totales AS (
    SELECT periodo, SUM(depositos_total) AS total_smf
    FROM base
    WHERE COALESCE(es_microfinanciera, FALSE) = TRUE
    GROUP BY periodo
)
SELECT
    b.periodo,
    b.nomb_correg,
    COALESCE(b.es_microfinanciera, FALSE) AS es_smf,
    CASE
        WHEN COALESCE(b.es_microfinanciera, FALSE) AND t.total_smf > 0
        THEN ROUND((b.depositos_total / t.total_smf)::numeric, 6)
        ELSE 0
    END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;

COMMENT ON VIEW marts.v_participacion_smf_depositos IS
    'Idem que v_participacion_smf_colocaciones pero sobre depositos totales.';
