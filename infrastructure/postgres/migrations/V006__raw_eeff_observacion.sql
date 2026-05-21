-- =========================================================================
-- V006: Tabla staging cruda de observaciones EEFF (Balance + Resultados)
--
-- Long-format: una fila por (periodo, entidad, moneda, tipo_estado, cuenta).
-- Sin FKs a dim_* — eso es responsabilidad de las transformaciones dbt
-- que mueven de raw.* a dw.*.
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.eeff_observacion (
    id                BIGSERIAL PRIMARY KEY,
    periodo           INT  NOT NULL,                  -- YYYYMM
    fecha_cierre      DATE NOT NULL,                  -- ultimo dia del mes
    tipo_estado       TEXT NOT NULL CHECK (tipo_estado IN ('balance', 'resultados')),

    -- Dimensiones de entidad (denormalizadas, tal cual vienen del BASE EE.FF.)
    empresa_sbs       TEXT,                            -- "BBVA"
    nomb_correg       TEXT NOT NULL,                   -- "BBVA Peru" (clave logica)
    tipo_entidad      TEXT NOT NULL,                   -- BANCOS|FINANCIERAS|CMAC|CRAC|EDPYMES
    microfinanciera   TEXT,                            -- "SI"/"NO"
    nacional          TEXT,                            -- "LOCAL"/"EXTRANJERO"

    -- Moneda
    moneda            TEXT NOT NULL CHECK (moneda IN ('MN', 'ME', 'TOTAL')),

    -- Cuenta
    cuenta_codigo     TEXT NOT NULL,                   -- "A1.1"
    cuenta_nombre     TEXT,                            -- "Caja"

    -- Valor
    valor             NUMERIC(20, 4),                  -- nullable

    -- Metadata de carga
    source            TEXT NOT NULL DEFAULT 'base_eeff',  -- 'base_eeff' | 'sbs_scrape'
    source_file       TEXT,
    loaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_eeff_unique
        UNIQUE (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo)
);

CREATE INDEX IF NOT EXISTS idx_raw_eeff_periodo
    ON raw.eeff_observacion (periodo);

CREATE INDEX IF NOT EXISTS idx_raw_eeff_entidad
    ON raw.eeff_observacion (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_raw_eeff_cuenta
    ON raw.eeff_observacion (cuenta_codigo);

CREATE INDEX IF NOT EXISTS idx_raw_eeff_periodo_entidad
    ON raw.eeff_observacion (periodo, nomb_correg);

COMMENT ON TABLE raw.eeff_observacion IS
    'Staging crudo de observaciones EEFF — long format. Una fila por '
    '(periodo, entidad, moneda, tipo_estado, cuenta). Sin FKs; dbt '
    'transformaciones llevan a dw.*';
