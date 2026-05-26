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
CREATE OR REPLACE VIEW marts.v_microfinancieras_historica AS
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
CREATE OR REPLACE VIEW marts.v_colocaciones_total_por_entidad AS
SELECT periodo, nomb_correg, cartera_bruta AS cartera_total
FROM marts.v_cartera_balance_entidad
WHERE cartera_bruta > 0;

COMMENT ON VIEW marts.v_colocaciones_total_por_entidad IS
    'Cartera total por entidad canonica desde el BALANCE (cta_a4_1+2+3). '
    'Antes usaba raw.colocaciones que excluye Consumo para algunas entidades.';


-- ============ V_COLOCACIONES_TOTAL_POR_ENTIDAD HISTORICA ============
CREATE OR REPLACE VIEW marts.v_colocaciones_total_historica AS
SELECT periodo, nomb_correg, cartera_bruta AS cartera_total
FROM marts.v_cartera_balance_historica
WHERE cartera_bruta > 0;


-- ============ PARTICIPACION SMF COLOC (CANONICO) ============
CREATE OR REPLACE VIEW marts.v_participacion_smf_colocaciones AS
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
CREATE OR REPLACE VIEW marts.v_participacion_smf_coloc_historica AS
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
