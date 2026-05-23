-- =========================================================================
-- V033: Staging crudo de COLOCACIONES (cartera de creditos por entidad)
--
-- Fuente: BASE COLOCACIONES.xlsx hoja '3.BDCreditos' (tidy format).
-- Una fila por (periodo, entidad, producto) con saldos Vigente/Reest/Atrasado/Total.
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.colocaciones_observacion (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,                    -- YYYYMM
    fecha_cierre        DATE NOT NULL,                    -- ultimo dia del mes

    -- Dimensiones de entidad
    empresa             TEXT NOT NULL,                    -- nombre original SBS
    empresa_benchmark   TEXT,                             -- nombre corto canonico
    tipo_entidad        TEXT NOT NULL,                    -- BANCOS/FINANCIERAS/CMAC/CRAC/EDPYMES
    clasificacion       TEXT,                             -- SF/SNF
    mayor_50_pct_cb     TEXT,                             -- ">50% CB" indicador capital extranjero

    -- Dimension producto
    producto            TEXT NOT NULL,                    -- "Comerciales", "Consumo", "Hipotecario", etc.
    prod_consumo        TEXT,                             -- subdivision consumo

    -- IDs SBS (utiles para deduplicacion / joins)
    id_empresa_sbs      INT,
    id_sistema_fin_sbs  INT,
    id_producto_sbs     INT,

    -- Metricas (en miles de soles)
    saldo_vigente       NUMERIC(20, 4),
    saldo_reest_refin   NUMERIC(20, 4),
    saldo_atrasado      NUMERIC(20, 4),
    saldo_total         NUMERIC(20, 4),

    -- Observaciones / texto libre del archivo
    observaciones       TEXT,

    -- Metadata de carga
    source              TEXT NOT NULL DEFAULT 'base_colocaciones',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_colocaciones_unique
        UNIQUE (periodo, empresa, producto, clasificacion, prod_consumo)
);

CREATE INDEX IF NOT EXISTS idx_raw_coloc_periodo
    ON raw.colocaciones_observacion (periodo);

CREATE INDEX IF NOT EXISTS idx_raw_coloc_empresa
    ON raw.colocaciones_observacion (empresa);

CREATE INDEX IF NOT EXISTS idx_raw_coloc_periodo_empresa
    ON raw.colocaciones_observacion (periodo, empresa);

CREATE INDEX IF NOT EXISTS idx_raw_coloc_producto
    ON raw.colocaciones_observacion (producto);

COMMENT ON TABLE raw.colocaciones_observacion IS
    'Staging crudo de COLOCACIONES (cartera de creditos por entidad y producto). '
    'Una fila por (periodo, entidad, producto). Saldos en miles de soles. '
    'Fuente: BASE COLOCACIONES.xlsx hoja 3.BDCreditos.';
