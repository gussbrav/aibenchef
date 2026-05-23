-- =========================================================================
-- V044: Tasas pasivas por entidad y producto/plazo
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.tasas_pasivas (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa_sbs         TEXT NOT NULL,                    -- ej "BANCO CONTINENTAL"
    entidad_benchmark   TEXT,
    tipo_entidad        TEXT NOT NULL,
    smf                 TEXT,                              -- SF (Sistema Financiero) / SNF

    producto            TEXT NOT NULL,                     -- "Ahorro" / "Plazo Hasta 30 dias" / "CTS"
    tasa_pct            NUMERIC(10, 4),

    source              TEXT NOT NULL DEFAULT 'base_tasas_pasivas',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_tasas_pas_unique UNIQUE (periodo, empresa_sbs, producto)
);

CREATE INDEX IF NOT EXISTS idx_raw_taspas_periodo ON raw.tasas_pasivas (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_taspas_empresa ON raw.tasas_pasivas (empresa_sbs);

DROP MATERIALIZED VIEW IF EXISTS marts.mv_tasas_pasivas_resumen CASCADE;
CREATE MATERIALIZED VIEW marts.mv_tasas_pasivas_resumen AS
SELECT
    periodo, fecha_cierre,
    empresa_sbs, entidad_benchmark, tipo_entidad, smf,
    producto, tasa_pct,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1 WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3 WHEN 'CRAC' THEN 4 WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.tasas_pasivas
WHERE tasa_pct IS NOT NULL;

CREATE INDEX idx_mv_taspas_periodo ON marts.mv_tasas_pasivas_resumen (periodo);
