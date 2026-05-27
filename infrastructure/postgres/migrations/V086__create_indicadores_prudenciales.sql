-- V086 — Tabla raw.indicadores_prudenciales
--
-- Almacena los indicadores financieros publicados por SBS en su reporte
-- consolidado mensual (B-2401 BANCOS, B-3301 FINANCIERAS, C-1301 CMAC,
-- C-2301 CRAC, C-4301 EDPYMES).
--
-- El archivo SBS es un layout horizontal multi-bloque: cada seccion
-- (SOLVENCIA / CALIDAD DE ACTIVOS / EFICIENCIA / RENTABILIDAD / LIQUIDEZ)
-- contiene N indicadores como filas, y las entidades aparecen como columnas
-- distribuidas en bloques de 8 separados por una columna en blanco.
--
-- Aqui los desnormalizamos a long-format: una fila por
-- (periodo, tipo_entidad, entidad, indicador).

CREATE TABLE IF NOT EXISTS raw.indicadores_prudenciales (
    id              BIGSERIAL PRIMARY KEY,
    periodo         INT  NOT NULL,
    fecha_cierre    DATE NOT NULL,
    tipo_entidad    TEXT NOT NULL,
    entidad         TEXT NOT NULL,
    seccion         TEXT NOT NULL,
    indicador       TEXT NOT NULL,
    indicador_slug  TEXT NOT NULL,
    valor           DOUBLE PRECISION NOT NULL,
    source          TEXT NOT NULL DEFAULT 'monthly_indicadores',
    source_file     TEXT NOT NULL,
    loaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_indicadores_prudenciales_natural
        UNIQUE (periodo, tipo_entidad, entidad, indicador_slug)
);

CREATE INDEX IF NOT EXISTS ix_indicadores_prudenciales_periodo
    ON raw.indicadores_prudenciales (periodo);

CREATE INDEX IF NOT EXISTS ix_indicadores_prudenciales_entidad
    ON raw.indicadores_prudenciales (entidad);

CREATE INDEX IF NOT EXISTS ix_indicadores_prudenciales_seccion
    ON raw.indicadores_prudenciales (seccion, indicador_slug);

COMMENT ON TABLE raw.indicadores_prudenciales IS
    'Indicadores financieros SBS — long-format desde reporte consolidado mensual.';
COMMENT ON COLUMN raw.indicadores_prudenciales.seccion IS
    'SOLVENCIA / CALIDAD_ACTIVOS / EFICIENCIA / RENTABILIDAD / LIQUIDEZ';
COMMENT ON COLUMN raw.indicadores_prudenciales.indicador_slug IS
    'Slug estable del indicador (ratio_capital_global, etc) — usar para joins/MVs.';
COMMENT ON COLUMN raw.indicadores_prudenciales.valor IS
    'Valor numerico publicado por SBS. Para indicadores en porcentaje, 15.81 = 15.81%.';
