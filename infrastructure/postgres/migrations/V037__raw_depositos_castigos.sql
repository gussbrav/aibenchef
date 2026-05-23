-- =========================================================================
-- V037: Staging crudo de DEPOSITOS y CASTIGOS
-- =========================================================================

-- ---------- DEPOSITOS ----------
CREATE TABLE IF NOT EXISTS raw.depositos_observacion (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa             TEXT NOT NULL,
    empresa_benchmark   TEXT,
    tipo_entidad        TEXT NOT NULL,
    clasificacion       TEXT,
    mayor_50_pct_mype   TEXT,

    producto            TEXT NOT NULL,                    -- Vista / Ahorro / Plazo / CTS

    -- Metricas (miles de soles)
    saldo_pers_nat              NUMERIC(20, 4),
    saldo_pers_jur_no_lucro     NUMERIC(20, 4),
    saldo_otras_pers_jur        NUMERIC(20, 4),
    saldo_total                 NUMERIC(20, 4),

    source              TEXT NOT NULL DEFAULT 'base_depositos',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_depositos_unique
        UNIQUE (periodo, empresa, producto, clasificacion)
);

CREATE INDEX IF NOT EXISTS idx_raw_dep_periodo
    ON raw.depositos_observacion (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_dep_empresa
    ON raw.depositos_observacion (empresa);
CREATE INDEX IF NOT EXISTS idx_raw_dep_periodo_empresa
    ON raw.depositos_observacion (periodo, empresa);

COMMENT ON TABLE raw.depositos_observacion IS
    'Staging crudo de depositos por entidad y producto. Fuente: BASE DEPOSITOS.xlsx hoja 4.BDAhorros.';


-- ---------- CASTIGOS ----------
CREATE TABLE IF NOT EXISTS raw.castigos_observacion (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    entidad             TEXT NOT NULL,            -- nombre original SBS
    entidad_final       TEXT,                     -- nombre corregido / actual
    empresa_benchmark   TEXT,
    tipo_entidad        TEXT NOT NULL,
    clasificacion       TEXT,
    mayor_50_pct_mype   TEXT,

    producto            TEXT NOT NULL,            -- Comerciales / Microempresa / Consumo / Hipotecario

    id_empresa_sbs      INT,
    id_sistema_fin_sbs  INT,
    id_producto_sbs     INT,

    saldo_castigos      NUMERIC(20, 4),

    source              TEXT NOT NULL DEFAULT 'base_castigos',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_castigos_unique
        UNIQUE (periodo, entidad, producto, clasificacion)
);

CREATE INDEX IF NOT EXISTS idx_raw_cast_periodo
    ON raw.castigos_observacion (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_cast_entidad
    ON raw.castigos_observacion (entidad);
CREATE INDEX IF NOT EXISTS idx_raw_cast_periodo_entidad
    ON raw.castigos_observacion (periodo, entidad);

COMMENT ON TABLE raw.castigos_observacion IS
    'Staging crudo de castigos (write-offs) por entidad y producto. '
    'Fuente: BASE CASTIGOS.xlsx hoja Castigos.';


-- ---------- MARTS ----------
DROP MATERIALIZED VIEW IF EXISTS marts.mv_depositos_resumen CASCADE;
CREATE MATERIALIZED VIEW marts.mv_depositos_resumen AS
SELECT
    periodo, fecha_cierre, tipo_entidad,
    empresa, empresa_benchmark, producto,
    COALESCE(saldo_pers_nat, 0)            AS saldo_pers_nat,
    COALESCE(saldo_pers_jur_no_lucro, 0)   AS saldo_pers_jur_no_lucro,
    COALESCE(saldo_otras_pers_jur, 0)      AS saldo_otras_pers_jur,
    COALESCE(saldo_total, 0)               AS saldo_total,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1
        WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3
        WHEN 'CRAC' THEN 4
        WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.depositos_observacion;

CREATE UNIQUE INDEX idx_mv_dep_unique ON marts.mv_depositos_resumen (periodo, empresa, producto);
CREATE INDEX idx_mv_dep_periodo ON marts.mv_depositos_resumen (periodo);

DROP MATERIALIZED VIEW IF EXISTS marts.mv_castigos_resumen CASCADE;
CREATE MATERIALIZED VIEW marts.mv_castigos_resumen AS
SELECT
    periodo, fecha_cierre, tipo_entidad,
    entidad, entidad_final, empresa_benchmark, producto,
    COALESCE(saldo_castigos, 0) AS saldo_castigos,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1
        WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3
        WHEN 'CRAC' THEN 4
        WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.castigos_observacion;

CREATE UNIQUE INDEX idx_mv_cast_unique ON marts.mv_castigos_resumen (periodo, entidad, producto);
CREATE INDEX idx_mv_cast_periodo ON marts.mv_castigos_resumen (periodo);
