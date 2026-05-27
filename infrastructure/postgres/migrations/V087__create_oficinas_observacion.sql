-- V087 — Tabla raw.oficinas_observacion
--
-- Almacena el numero de oficinas por (empresa, departamento, periodo)
-- publicado por SBS en su reporte mensual del topico oficinas:
-- B-2303 BANCOS, B-3201 FINANCIERAS, C-1201 CMAC, C-2201 CRAC, C-4205 EDPYMES.
--
-- El archivo SBS es un grid simple:
--   col 0 = empresa
--   col 1..N = departamento (Amazonas, Ancash, ..., Lima Metropolitana, ..., Tumbes)
--   valor = # oficinas de la empresa en ese departamento
--
-- Aqui lo desnormalizamos a long-format: una fila por
-- (periodo, tipo_entidad, empresa, departamento).
--
-- NOTA: NO confundir con raw.creditos_depositos_oficina (saldos de creditos y
-- depositos por oficina) — esta tabla solo cuenta el numero de oficinas.

CREATE TABLE IF NOT EXISTS raw.oficinas_observacion (
    id              BIGSERIAL PRIMARY KEY,
    periodo         INT  NOT NULL,
    fecha_cierre    DATE NOT NULL,
    tipo_entidad    TEXT NOT NULL,
    empresa         TEXT NOT NULL,
    departamento    TEXT NOT NULL,
    n_oficinas      INT  NOT NULL,
    source          TEXT NOT NULL DEFAULT 'monthly_oficinas_grid',
    source_file     TEXT NOT NULL,
    loaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_oficinas_observacion_natural
        UNIQUE (periodo, tipo_entidad, empresa, departamento)
);

CREATE INDEX IF NOT EXISTS ix_oficinas_observacion_periodo
    ON raw.oficinas_observacion (periodo);

CREATE INDEX IF NOT EXISTS ix_oficinas_observacion_empresa
    ON raw.oficinas_observacion (empresa);

CREATE INDEX IF NOT EXISTS ix_oficinas_observacion_depto
    ON raw.oficinas_observacion (departamento);

COMMENT ON TABLE raw.oficinas_observacion IS
    'Numero de oficinas por (empresa, departamento, periodo) desde reporte SBS mensual.';
COMMENT ON COLUMN raw.oficinas_observacion.n_oficinas IS
    'Cantidad de oficinas de la empresa en el departamento al cierre del periodo.';
