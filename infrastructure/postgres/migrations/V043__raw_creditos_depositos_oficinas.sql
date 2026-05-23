-- =========================================================================
-- V043: Creditos y Depositos por OFICINA (granularidad maxima geografica)
-- ~1M filas
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.creditos_depositos_oficina (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    -- Entidad
    empresa_sbs         TEXT NOT NULL,
    empresa             TEXT,
    empresa_benchmark   TEXT,
    tipo_entidad        TEXT NOT NULL,
    clasificacion       TEXT,
    mayor_50_pct_cb     TEXT,

    -- Geografia
    departamento        TEXT NOT NULL,
    provincia           TEXT,
    distrito            TEXT,
    departamento_distrito TEXT,                            -- "Apurimac_Abancay"
    region_caqp         TEXT,                              -- region SBS
    region_caqp_sp      TEXT,                              -- variante S/P

    codigo_oficina      INT,                               -- codigo SBS interno

    -- Producto (Ahorro, Vista, Plazo, CTS, Comerciales, etc.)
    producto            TEXT NOT NULL,

    -- Saldos por moneda (miles de soles equivalentes)
    saldo_mn            NUMERIC(20, 4),
    saldo_me            NUMERIC(20, 4),
    saldo_total         NUMERIC(20, 4),

    source              TEXT NOT NULL DEFAULT 'base_creditos_depositos_oficina',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_cred_dep_of_unique
        UNIQUE (periodo, empresa_sbs, codigo_oficina, producto, departamento_distrito)
);

CREATE INDEX IF NOT EXISTS idx_raw_cdo_periodo
    ON raw.creditos_depositos_oficina (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_cdo_empresa
    ON raw.creditos_depositos_oficina (empresa_sbs);
CREATE INDEX IF NOT EXISTS idx_raw_cdo_depto
    ON raw.creditos_depositos_oficina (departamento);
CREATE INDEX IF NOT EXISTS idx_raw_cdo_region
    ON raw.creditos_depositos_oficina (region_caqp);
CREATE INDEX IF NOT EXISTS idx_raw_cdo_producto
    ON raw.creditos_depositos_oficina (producto);

COMMENT ON TABLE raw.creditos_depositos_oficina IS
    'Cartera y depositos por oficina/distrito (granularidad maxima geografica). '
    '~1M filas, fuente principal para mapas de cobertura territorial.';


-- Mart agregado por departamento + producto + tipo entidad
DROP MATERIALIZED VIEW IF EXISTS marts.mv_cobertura_geografica CASCADE;
CREATE MATERIALIZED VIEW marts.mv_cobertura_geografica AS
SELECT
    periodo, fecha_cierre,
    departamento, region_caqp,
    tipo_entidad, producto,
    COUNT(DISTINCT empresa_sbs)          AS n_entidades,
    COUNT(DISTINCT distrito)             AS n_distritos,
    COUNT(DISTINCT codigo_oficina)       AS n_oficinas,
    SUM(saldo_mn)                        AS saldo_mn_total,
    SUM(saldo_me)                        AS saldo_me_total,
    SUM(saldo_total)                     AS saldo_total,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1 WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3 WHEN 'CRAC' THEN 4 WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.creditos_depositos_oficina
GROUP BY periodo, fecha_cierre, departamento, region_caqp, tipo_entidad, producto;

CREATE INDEX idx_mv_cob_periodo ON marts.mv_cobertura_geografica (periodo);
CREATE INDEX idx_mv_cob_depto ON marts.mv_cobertura_geografica (departamento);
CREATE INDEX idx_mv_cob_tipo ON marts.mv_cobertura_geografica (tipo_entidad);
