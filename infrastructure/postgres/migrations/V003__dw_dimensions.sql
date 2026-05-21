-- =========================================================================
-- V003: Dimensiones del DW
-- Compartidas entre tenants (data SBS es publica)
-- =========================================================================

-- ---------- dim_tiempo ----------
CREATE TABLE IF NOT EXISTS dw.dim_tiempo (
  id              INT PRIMARY KEY,                   -- YYYYMM (ej: 202403 = marzo 2024)
  anio            INT NOT NULL,
  mes             SMALLINT NOT NULL,
  trimestre       SMALLINT NOT NULL,
  semestre        SMALLINT NOT NULL,
  mes_nombre      TEXT NOT NULL,                     -- 'Enero', 'Febrero', ...
  mes_abrev       TEXT NOT NULL,                     -- 'Ene', 'Feb', ...
  periodo_iso     TEXT NOT NULL,                     -- 'YYYY-MM'
  fecha_cierre    DATE NOT NULL,                     -- ultimo dia del mes
  UNIQUE (anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_tiempo_anio ON dw.dim_tiempo (anio);
CREATE INDEX IF NOT EXISTS idx_tiempo_fecha ON dw.dim_tiempo (fecha_cierre);

-- ---------- dim_entidad ----------
CREATE TABLE IF NOT EXISTS dw.dim_entidad (
  id              SERIAL PRIMARY KEY,
  codigo_sbs      TEXT NOT NULL UNIQUE,              -- codigo numerico SBS (ej '2401')
  nombre          TEXT NOT NULL,
  nombre_corto    TEXT,
  grupo           TEXT NOT NULL
                  CHECK (grupo IN ('banca_multiple','financiera','cmac','crac','edpyme')),
  es_microfinanciera BOOLEAN NOT NULL DEFAULT false,
  activa          BOOLEAN NOT NULL DEFAULT true,
  fecha_inicio    DATE,
  fecha_fin       DATE,
  ruc             TEXT,
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_entidad_grupo ON dw.dim_entidad (grupo);
CREATE INDEX IF NOT EXISTS idx_entidad_nombre_trgm ON dw.dim_entidad USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entidad_activa ON dw.dim_entidad (activa);

-- ---------- dim_moneda ----------
CREATE TABLE IF NOT EXISTS dw.dim_moneda (
  id              SMALLINT PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,              -- 'PEN', 'USD', 'TOT'
  nombre          TEXT NOT NULL                      -- 'Soles', 'Dolares', 'Total consolidado'
);

INSERT INTO dw.dim_moneda (id, codigo, nombre) VALUES
  (1, 'PEN', 'Soles'),
  (2, 'USD', 'Dolares'),
  (3, 'TOT', 'Total consolidado')
ON CONFLICT (id) DO NOTHING;

-- ---------- dim_cuenta ----------
-- Catalogo regulatorio SBS. Cada cuenta es una linea de los EEFF u otros topicos.
CREATE TABLE IF NOT EXISTS dw.dim_cuenta (
  id              SERIAL PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,              -- 'A1_DISPONIBLE', 'A1_1_CAJA'
  nombre          TEXT NOT NULL,
  parent_codigo   TEXT REFERENCES dw.dim_cuenta(codigo) DEFERRABLE,
  nivel           SMALLINT NOT NULL,                 -- 1 = root, 2..n = hijos
  tipo_estado     TEXT NOT NULL
                  CHECK (tipo_estado IN ('BG','ER','NOTAS','COLOCACIONES','DEPOSITOS','CASTIGOS','CLIENTES','OFICINAS','PERSONAL','INDICADORES')),
  topico          TEXT NOT NULL,                     -- 'eeff', 'colocaciones', ...
  orden           INT NOT NULL DEFAULT 0,            -- orden de presentacion
  signo           SMALLINT NOT NULL DEFAULT 1        -- 1 normal, -1 si la cuenta resta
);

CREATE INDEX IF NOT EXISTS idx_cuenta_tipo ON dw.dim_cuenta (tipo_estado);
CREATE INDEX IF NOT EXISTS idx_cuenta_topico ON dw.dim_cuenta (topico);
CREATE INDEX IF NOT EXISTS idx_cuenta_parent ON dw.dim_cuenta (parent_codigo);

-- ---------- dim_geografia ----------
CREATE TABLE IF NOT EXISTS dw.dim_geografia (
  id              SERIAL PRIMARY KEY,
  ubigeo          TEXT UNIQUE,                       -- codigo ubigeo INEI
  departamento    TEXT NOT NULL,
  provincia       TEXT,
  distrito        TEXT,
  region          TEXT,                              -- 'norte','centro','sur','oriente','lima'
  zona            TEXT                               -- 'urbana','rural','mixta'
);

CREATE INDEX IF NOT EXISTS idx_geo_depto ON dw.dim_geografia (departamento);
CREATE INDEX IF NOT EXISTS idx_geo_region ON dw.dim_geografia (region);

-- ---------- dim_tipo_credito ----------
CREATE TABLE IF NOT EXISTS dw.dim_tipo_credito (
  id              SMALLINT PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  categoria       TEXT                               -- 'empresarial','consumo','hipotecario'
);

INSERT INTO dw.dim_tipo_credito (id, codigo, nombre, categoria) VALUES
  (1, 'corporativo',         'Corporativo',                 'empresarial'),
  (2, 'gran_empresa',        'Gran empresa',                'empresarial'),
  (3, 'mediana_empresa',     'Mediana empresa',             'empresarial'),
  (4, 'pequena_empresa',     'Pequena empresa',             'empresarial'),
  (5, 'microempresa',        'Microempresa',                'empresarial'),
  (6, 'consumo_revolvente',  'Consumo revolvente',          'consumo'),
  (7, 'consumo_no_revolv',   'Consumo no revolvente',       'consumo'),
  (8, 'hipotecario',         'Hipotecario para vivienda',   'hipotecario')
ON CONFLICT (id) DO NOTHING;

-- ---------- dim_tipo_deposito ----------
CREATE TABLE IF NOT EXISTS dw.dim_tipo_deposito (
  id              SMALLINT PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL
);

INSERT INTO dw.dim_tipo_deposito (id, codigo, nombre) VALUES
  (1, 'vista',  'Vista'),
  (2, 'ahorro', 'Ahorro'),
  (3, 'plazo',  'Plazo'),
  (4, 'cts',    'CTS')
ON CONFLICT (id) DO NOTHING;
