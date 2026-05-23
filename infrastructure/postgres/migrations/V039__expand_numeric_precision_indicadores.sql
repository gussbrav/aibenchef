-- =========================================================================
-- V039: Expandir precision numerica en indicadores prudenciales
--
-- Los archivos SBS tienen formato variable: algunas filas traen porcentajes
-- (0-100), otras traen montos absolutos en miles de soles. Necesitamos
-- NUMERIC(20,6) para que entren ambos.
-- =========================================================================

-- Dropear MV que depende de las columnas (se recrea al final)
DROP MATERIALIZED VIEW IF EXISTS marts.mv_indicadores_prudenciales CASCADE;

ALTER TABLE raw.patrimonio_efectivo
    ALTER COLUMN nivel_1_pct TYPE NUMERIC(20, 6),
    ALTER COLUMN nivel_2_pct TYPE NUMERIC(20, 6),
    ALTER COLUMN nivel_3_pct TYPE NUMERIC(20, 6);

ALTER TABLE raw.ratio_liquidez
    ALTER COLUMN rl_mn TYPE NUMERIC(20, 6),
    ALTER COLUMN rl_me TYPE NUMERIC(20, 6);

ALTER TABLE raw.ratio_capital_global
    ALTER COLUMN rcg_pct TYPE NUMERIC(20, 6);

-- Recrear MV
CREATE MATERIALIZED VIEW marts.mv_indicadores_prudenciales AS
SELECT
    COALESCE(p.periodo, l.periodo, r.periodo)             AS periodo,
    COALESCE(p.fecha_cierre, l.fecha_cierre, r.fecha_cierre) AS fecha_cierre,
    COALESCE(p.empresa, l.empresa, r.empresa)             AS empresa,
    COALESCE(p.tipo_entidad, l.tipo_entidad, r.tipo_entidad) AS tipo_entidad,
    p.pe_total                                            AS patrimonio_efectivo_total,
    p.nivel_1_pct                                         AS pe_nivel_1_pct,
    p.pe_nivel_1_soles                                    AS pe_nivel_1_soles,
    l.rl_mn                                               AS ratio_liquidez_mn,
    l.rl_me                                               AS ratio_liquidez_me,
    r.rcg_pct                                             AS rcg,
    r.apr_total                                           AS apr_total,
    r.apr_total_adic                                      AS apr_total_adicional,
    CASE COALESCE(p.tipo_entidad, l.tipo_entidad, r.tipo_entidad)
        WHEN 'BANCOS' THEN 1
        WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3
        WHEN 'CRAC' THEN 4
        WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.patrimonio_efectivo p
FULL OUTER JOIN raw.ratio_liquidez l
    ON p.periodo = l.periodo AND p.empresa = l.empresa
FULL OUTER JOIN raw.ratio_capital_global r
    ON COALESCE(p.periodo, l.periodo) = r.periodo
   AND COALESCE(p.empresa, l.empresa) = r.empresa;

CREATE UNIQUE INDEX idx_mv_indicadores_unique
    ON marts.mv_indicadores_prudenciales (periodo, empresa);
CREATE INDEX idx_mv_indicadores_periodo ON marts.mv_indicadores_prudenciales (periodo);
