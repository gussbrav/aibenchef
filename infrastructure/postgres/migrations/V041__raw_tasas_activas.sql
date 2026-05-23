-- =========================================================================
-- V041: Tasas activas por entidad y segmento (long format despues de unpivot)
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.tasas_activas (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa_sbs         TEXT NOT NULL,
    nomb_correg         TEXT,
    tipo_entidad        TEXT NOT NULL,
    microfinanciera     TEXT,

    -- Categoria principal (Corporativos / Grandes Empresas / Medianas / Pequenas /
    -- Microempresas / Consumo / Hipotecarios)
    segmento_credito    TEXT NOT NULL,
    -- Tipo de operacion / plazo dentro del segmento
    tipo_operacion      TEXT NOT NULL,

    tasa_pct            NUMERIC(10, 4),                   -- % tasa efectiva anual

    source              TEXT NOT NULL DEFAULT 'base_tasas_activas',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_tasas_act_unique UNIQUE (periodo, empresa_sbs, segmento_credito, tipo_operacion)
);

CREATE INDEX IF NOT EXISTS idx_raw_tasact_periodo ON raw.tasas_activas (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_tasact_empresa ON raw.tasas_activas (empresa_sbs);
CREATE INDEX IF NOT EXISTS idx_raw_tasact_segmento ON raw.tasas_activas (segmento_credito);

COMMENT ON TABLE raw.tasas_activas IS
    'Tasas activas (de creditos) por entidad/segmento/plazo. Long format despues de unpivot. '
    'Fuente: BASE TASAS ACTIVAS.xlsx hoja Data.';


DROP MATERIALIZED VIEW IF EXISTS marts.mv_tasas_activas_resumen CASCADE;
CREATE MATERIALIZED VIEW marts.mv_tasas_activas_resumen AS
SELECT
    periodo, fecha_cierre,
    empresa_sbs, nomb_correg, tipo_entidad, microfinanciera,
    segmento_credito, tipo_operacion, tasa_pct,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1 WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3 WHEN 'CRAC' THEN 4 WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.tasas_activas
WHERE tasa_pct IS NOT NULL;

CREATE INDEX idx_mv_tasact_periodo ON marts.mv_tasas_activas_resumen (periodo);
CREATE INDEX idx_mv_tasact_empresa ON marts.mv_tasas_activas_resumen (empresa_sbs);
CREATE INDEX idx_mv_tasact_segmento ON marts.mv_tasas_activas_resumen (segmento_credito);
