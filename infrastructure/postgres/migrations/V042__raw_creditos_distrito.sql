-- =========================================================================
-- V042: Creditos por tipo y distrito (geografico)
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.creditos_distrito (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    -- Geografia
    nom_bd              TEXT,                              -- identificador SBS (Depto_Distrito)
    departamento        TEXT NOT NULL,
    provincia           TEXT,
    distrito            TEXT,
    region_caja         TEXT,                              -- Region Norte/Sur/Centro/Oriente

    -- Tipo de credito (8 tipos canonicos SBS)
    tipo_credito        TEXT NOT NULL,                     -- "1. Corporativos", "2. Pequenas Empresas", etc.
    tipo_base           TEXT,                              -- categoria base

    -- Saldos por tipo de entidad (miles)
    saldo_bancos        NUMERIC(20, 4),
    saldo_financieras   NUMERIC(20, 4),
    saldo_cmac          NUMERIC(20, 4),
    saldo_crac          NUMERIC(20, 4),
    saldo_edpymes       NUMERIC(20, 4),
    saldo_total_tipo    NUMERIC(20, 4),                    -- Total tipo credito en este distrito
    saldo_total_directos NUMERIC(20, 4),                   -- Total creditos directos

    source              TEXT NOT NULL DEFAULT 'base_creditos_distrito',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_cred_dist_unique
        UNIQUE (periodo, departamento, distrito, tipo_credito)
);

CREATE INDEX IF NOT EXISTS idx_raw_creddist_periodo
    ON raw.creditos_distrito (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_creddist_depto
    ON raw.creditos_distrito (departamento);
CREATE INDEX IF NOT EXISTS idx_raw_creddist_region
    ON raw.creditos_distrito (region_caja);
CREATE INDEX IF NOT EXISTS idx_raw_creddist_tipo
    ON raw.creditos_distrito (tipo_credito);

COMMENT ON TABLE raw.creditos_distrito IS
    'Cartera de creditos por tipo y geografia (departamento/provincia/distrito). '
    'Wide format: 1 fila por (periodo, distrito, tipo_credito) con saldos por tipo de entidad.';


-- Mart con unpivot a long para queries comparativas por tipo entidad
DROP MATERIALIZED VIEW IF EXISTS marts.mv_creditos_distrito_long CASCADE;
CREATE MATERIALIZED VIEW marts.mv_creditos_distrito_long AS
SELECT periodo, fecha_cierre, departamento, provincia, distrito, region_caja,
       tipo_credito, tipo_base, 'BANCOS'::text AS tipo_entidad,
       saldo_bancos AS saldo
FROM raw.creditos_distrito WHERE saldo_bancos IS NOT NULL
UNION ALL
SELECT periodo, fecha_cierre, departamento, provincia, distrito, region_caja,
       tipo_credito, tipo_base, 'FINANCIERAS'::text, saldo_financieras
FROM raw.creditos_distrito WHERE saldo_financieras IS NOT NULL
UNION ALL
SELECT periodo, fecha_cierre, departamento, provincia, distrito, region_caja,
       tipo_credito, tipo_base, 'CMAC'::text, saldo_cmac
FROM raw.creditos_distrito WHERE saldo_cmac IS NOT NULL
UNION ALL
SELECT periodo, fecha_cierre, departamento, provincia, distrito, region_caja,
       tipo_credito, tipo_base, 'CRAC'::text, saldo_crac
FROM raw.creditos_distrito WHERE saldo_crac IS NOT NULL
UNION ALL
SELECT periodo, fecha_cierre, departamento, provincia, distrito, region_caja,
       tipo_credito, tipo_base, 'EDPYMES'::text, saldo_edpymes
FROM raw.creditos_distrito WHERE saldo_edpymes IS NOT NULL;

CREATE INDEX idx_mv_cred_dist_long_periodo
    ON marts.mv_creditos_distrito_long (periodo);
CREATE INDEX idx_mv_cred_dist_long_depto
    ON marts.mv_creditos_distrito_long (departamento);
CREATE INDEX idx_mv_cred_dist_long_tipo_ent
    ON marts.mv_creditos_distrito_long (tipo_entidad);
