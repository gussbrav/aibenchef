-- =========================================================================
-- V040: Numero de clientes por entidad (ahorros + creditos)
-- =========================================================================

-- ---------- CLIENTES AHORROS ----------
CREATE TABLE IF NOT EXISTS raw.clientes_ahorros (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa             TEXT NOT NULL,
    empresa_benchmark   TEXT,
    tipo_entidad        TEXT NOT NULL,
    clasificacion       TEXT,
    mayor_50_pct_mype   TEXT,

    producto            TEXT NOT NULL,                -- A la vista / Ahorro / Plazo / CTS

    -- Numero de clientes por segmento
    n_pers_nat              INT,
    n_pers_jur_no_lucro     INT,
    n_otras_pers_jur        INT,
    n_total                 INT,

    source              TEXT NOT NULL DEFAULT 'base_clientes_ahorros',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_clie_aho_unique UNIQUE (periodo, empresa, producto, clasificacion)
);
CREATE INDEX IF NOT EXISTS idx_raw_cliaho_periodo ON raw.clientes_ahorros (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_cliaho_empresa ON raw.clientes_ahorros (empresa);


-- ---------- CLIENTES CREDITOS ----------
CREATE TABLE IF NOT EXISTS raw.clientes_creditos (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa             TEXT NOT NULL,
    empresa_benchmark   TEXT,
    tipo_entidad        TEXT NOT NULL,
    clasificacion       TEXT,
    mayor_50_pct_cb     TEXT,

    producto            TEXT NOT NULL,                -- Comerciales / Microempresa / Consumo / etc

    n_clientes          INT,

    source              TEXT NOT NULL DEFAULT 'base_clientes_creditos',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_clie_cred_unique UNIQUE (periodo, empresa, producto, clasificacion)
);
CREATE INDEX IF NOT EXISTS idx_raw_cliecred_periodo ON raw.clientes_creditos (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_cliecred_empresa ON raw.clientes_creditos (empresa);


-- ---------- MART ----------
DROP MATERIALIZED VIEW IF EXISTS marts.mv_clientes_resumen CASCADE;
CREATE MATERIALIZED VIEW marts.mv_clientes_resumen AS
SELECT
    'ahorros'::text                  AS tipo,
    periodo, fecha_cierre,
    empresa, empresa_benchmark, tipo_entidad, producto,
    n_total                          AS n_clientes,
    n_pers_nat,
    n_pers_jur_no_lucro,
    n_otras_pers_jur,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1 WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3 WHEN 'CRAC' THEN 4 WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.clientes_ahorros
UNION ALL
SELECT
    'creditos'::text                 AS tipo,
    periodo, fecha_cierre,
    empresa, empresa_benchmark, tipo_entidad, producto,
    n_clientes,
    NULL::INT, NULL::INT, NULL::INT,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1 WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3 WHEN 'CRAC' THEN 4 WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.clientes_creditos;

CREATE INDEX idx_mv_clientes_periodo ON marts.mv_clientes_resumen (periodo);
CREATE INDEX idx_mv_clientes_empresa ON marts.mv_clientes_resumen (empresa);
CREATE INDEX idx_mv_clientes_tipo ON marts.mv_clientes_resumen (tipo);
