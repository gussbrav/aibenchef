-- =========================================================================
-- V200: Scaffold multi-país + dw.dim_segmento
--
-- Objetivos:
--   1. dw.dim_segmento: tabla de referencia que reemplaza el CHECK enum en
--      cabecera_maestra.tipo_entidad. Agregar Bolivia (ASFI) = INSERT, no
--      ALTER TABLE.
--   2. Columnas pais/regulador en tablas de raw + dimensiones para coexistir
--      con datos de otros reguladores sin cambiar el modelo lógico.
--   3. nombre_fuente + parent_codigo en cabecera_maestra: habilitan que el
--      importer COOPAC cargue su mapa de cuentas desde DB en vez de
--      constantes Python. FK reemplaza CHECK para extensibilidad.
--
-- IDEMPOTENTE: IF NOT EXISTS, ON CONFLICT DO NOTHING, IF EXISTS en DROP.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. dw.dim_segmento — registro canónico de segmentos por país/regulador
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.dim_segmento (
    codigo        TEXT PRIMARY KEY,
    pais          TEXT NOT NULL DEFAULT 'PE',
    regulador     TEXT NOT NULL DEFAULT 'SBS',
    nombre        TEXT NOT NULL,
    descripcion   TEXT,
    signo_gastos  SMALLINT NOT NULL DEFAULT -1
        CHECK (signo_gastos IN (1, -1)),
    activo        BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE dw.dim_segmento IS
    'Registro canónico de segmentos por país y regulador. '
    'Agregar nuevo país o segmento = INSERT aquí, no ALTER TABLE. '
    'signo_gastos: -1 = SF (gastos publicados negativos en Excel SBS), '
    '+1 = COOPAC (gastos publicados positivos en Excel SBS).';

COMMENT ON COLUMN dw.dim_segmento.signo_gastos IS
    '-1: SF/ASFI almacena gastos financieros como valores negativos. '
    '+1: COOPAC SBS almacena gastos financieros como valores positivos. '
    'Usado por el importer y fórmulas KPI para normalizar signos.';

INSERT INTO dw.dim_segmento (codigo, pais, regulador, nombre, signo_gastos) VALUES
    ('BANCOS',      'PE', 'SBS', 'Banca Múltiple',                                    -1),
    ('FINANCIERAS', 'PE', 'SBS', 'Empresas Financieras',                              -1),
    ('CMAC',        'PE', 'SBS', 'Cajas Municipales de Ahorro y Crédito',             -1),
    ('CRAC',        'PE', 'SBS', 'Cajas Rurales de Ahorro y Crédito',                 -1),
    ('EDPYMES',     'PE', 'SBS', 'Empresas de Desarrollo de la Pequeña y Micro Empresa', -1),
    ('COOPAC_N3',   'PE', 'SBS', 'Cooperativas de Ahorro y Crédito Nivel 3',           1),
    ('COOPAC_N2B',  'PE', 'SBS', 'Cooperativas de Ahorro y Crédito Nivel 2B',          1),
    ('COOPAC_N2A',  'PE', 'SBS', 'Cooperativas de Ahorro y Crédito Nivel 2A',          1),
    ('COOPAC_N1',   'PE', 'SBS', 'Cooperativas de Ahorro y Crédito Nivel 1',           1)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. raw.eeff_observacion — scaffold multi-país
-- ---------------------------------------------------------------------------
ALTER TABLE raw.eeff_observacion
    ADD COLUMN IF NOT EXISTS pais      TEXT NOT NULL DEFAULT 'PE',
    ADD COLUMN IF NOT EXISTS regulador TEXT NOT NULL DEFAULT 'SBS';

CREATE INDEX IF NOT EXISTS idx_eeff_obs_pais ON raw.eeff_observacion (pais, regulador);

COMMENT ON COLUMN raw.eeff_observacion.pais IS
    'País de origen del regulador. PE = Perú (SBS). Futuro: BO = Bolivia (ASFI).';

-- ---------------------------------------------------------------------------
-- 3. dw.dim_entidad — scaffold multi-país
-- ---------------------------------------------------------------------------
ALTER TABLE dw.dim_entidad
    ADD COLUMN IF NOT EXISTS pais      TEXT NOT NULL DEFAULT 'PE',
    ADD COLUMN IF NOT EXISTS regulador TEXT NOT NULL DEFAULT 'SBS';

CREATE INDEX IF NOT EXISTS idx_dim_entidad_pais ON dw.dim_entidad (pais, regulador);

-- ---------------------------------------------------------------------------
-- 4. dw.dim_cuenta — scaffold multi-país
-- ---------------------------------------------------------------------------
ALTER TABLE dw.dim_cuenta
    ADD COLUMN IF NOT EXISTS pais TEXT NOT NULL DEFAULT 'PE';

-- ---------------------------------------------------------------------------
-- 5. dw.cabecera_maestra — columnas para matching data-driven + multi-país
-- ---------------------------------------------------------------------------
ALTER TABLE dw.cabecera_maestra
    ADD COLUMN IF NOT EXISTS pais          TEXT NOT NULL DEFAULT 'PE',
    ADD COLUMN IF NOT EXISTS regulador     TEXT NOT NULL DEFAULT 'SBS',
    ADD COLUMN IF NOT EXISTS nombre_fuente TEXT,
    ADD COLUMN IF NOT EXISTS parent_codigo TEXT;

COMMENT ON COLUMN dw.cabecera_maestra.nombre_fuente IS
    'Texto exacto del encabezado de fila en el archivo Excel SBS/ASFI. '
    'NULL = usar nombre para matching (coinciden tras _normalize). '
    'El importer usa COALESCE(nombre_fuente, nombre) como clave de búsqueda.';

COMMENT ON COLUMN dw.cabecera_maestra.parent_codigo IS
    'Código del parent inmediato en la jerarquía. '
    'NULL = cuenta raíz (secciones ACTIVO/PASIVO/PATRIMONIO en BG, '
    'o cuentas top-level sin sección padre en GYP). '
    'Permite lookup (parent_codigo, nombre_norm) → codigo, '
    'resolviendo ambigüedades cuando el mismo texto aparece '
    'en distintas secciones (ej. FONDOS INTERCOOPERATIVOS en Activo vs Pasivo).';

-- ---------------------------------------------------------------------------
-- 6. Reemplazar CHECK por FK a dim_segmento en cabecera_maestra
--
-- V190 dejó el constraint con nombre 'cabecera_maestra_tipo_entidad_ck'.
-- Lo reemplazamos por FK para que agregar Bolivia = INSERT en dim_segmento.
-- ---------------------------------------------------------------------------
ALTER TABLE dw.cabecera_maestra
    DROP CONSTRAINT IF EXISTS cabecera_maestra_tipo_entidad_ck,
    DROP CONSTRAINT IF EXISTS cabecera_maestra_tipo_entidad_check,
    DROP CONSTRAINT IF EXISTS cabecera_maestra_tipo_entidad_fk;

ALTER TABLE dw.cabecera_maestra
    ADD CONSTRAINT cabecera_maestra_tipo_entidad_fk
    FOREIGN KEY (tipo_entidad) REFERENCES dw.dim_segmento(codigo);

COMMENT ON CONSTRAINT cabecera_maestra_tipo_entidad_fk ON dw.cabecera_maestra IS
    'FK a dw.dim_segmento. Agregar nuevo segmento/país = INSERT en dim_segmento, '
    'no ALTER TABLE. Bolivia (ASFI) → INSERT INTO dw.dim_segmento VALUES (''EFV'', ''BO'', ''ASFI'', ...).';
