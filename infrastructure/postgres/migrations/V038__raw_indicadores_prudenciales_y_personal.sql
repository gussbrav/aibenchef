-- =========================================================================
-- V038: Indicadores prudenciales (Patrimonio Efectivo, Ratio Liquidez, RCG) + Personal
-- =========================================================================

-- ---------- PATRIMONIO EFECTIVO ----------
CREATE TABLE IF NOT EXISTS raw.patrimonio_efectivo (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa             TEXT NOT NULL,
    tipo_entidad        TEXT NOT NULL,

    -- Composicion del patrimonio efectivo (porcentajes)
    nivel_1_pct         NUMERIC(10, 4),                   -- % capital primario (Tier 1)
    nivel_2_pct         NUMERIC(10, 4),                   -- % capital secundario (Tier 2)
    nivel_3_pct         NUMERIC(10, 4),                   -- % Tier 3 (legacy, normalmente 0)

    -- Montos absolutos
    pe_total            NUMERIC(20, 4),                   -- Patrimonio Efectivo total (miles)
    pe_nivel_1_soles    NUMERIC(20, 4),                   -- Tier 1 en soles

    source              TEXT NOT NULL DEFAULT 'base_patrimonio',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_patrimonio_unique UNIQUE (periodo, empresa)
);
CREATE INDEX IF NOT EXISTS idx_raw_pat_periodo ON raw.patrimonio_efectivo (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_pat_empresa ON raw.patrimonio_efectivo (empresa);

COMMENT ON TABLE raw.patrimonio_efectivo IS
    'Patrimonio Efectivo (Tier 1, 2, 3) por entidad y periodo. Indicador prudencial clave.';


-- ---------- RATIO DE LIQUIDEZ ----------
CREATE TABLE IF NOT EXISTS raw.ratio_liquidez (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa             TEXT NOT NULL,
    tipo_entidad        TEXT NOT NULL,

    -- Moneda Nacional
    activo_mn           NUMERIC(20, 4),
    pasivo_mn           NUMERIC(20, 4),
    rl_mn               NUMERIC(10, 4),                   -- % ratio liquidez MN

    -- Moneda Extranjera
    activo_me           NUMERIC(20, 4),
    pasivo_me           NUMERIC(20, 4),
    rl_me               NUMERIC(10, 4),                   -- % ratio liquidez ME

    source              TEXT NOT NULL DEFAULT 'base_ratio_liquidez',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_liquidez_unique UNIQUE (periodo, empresa)
);
CREATE INDEX IF NOT EXISTS idx_raw_liq_periodo ON raw.ratio_liquidez (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_liq_empresa ON raw.ratio_liquidez (empresa);

COMMENT ON TABLE raw.ratio_liquidez IS
    'Ratio de Liquidez por entidad en MN y ME. Activo liquido / pasivo a corto plazo.';


-- ---------- RATIO DE CAPITAL GLOBAL (RCG) ----------
CREATE TABLE IF NOT EXISTS raw.ratio_capital_global (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa             TEXT NOT NULL,
    tipo_entidad        TEXT NOT NULL,

    -- Activos ponderados por riesgo (APR) base
    apr_credito         NUMERIC(20, 4),
    apr_mercado         NUMERIC(20, 4),
    apr_operacional     NUMERIC(20, 4),
    apr_total           NUMERIC(20, 4),

    -- APR adicionales (requerimientos extra Basilea III)
    apr_credito_adic    NUMERIC(20, 4),
    apr_mercado_adic    NUMERIC(20, 4),
    apr_operacional_adic NUMERIC(20, 4),
    apr_total_adic      NUMERIC(20, 4),

    patrimonio_efectivo NUMERIC(20, 4),
    rcg_pct             NUMERIC(10, 4),                   -- RCG en % (>10 mínimo regulatorio)

    source              TEXT NOT NULL DEFAULT 'base_rcg',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_rcg_unique UNIQUE (periodo, empresa)
);
CREATE INDEX IF NOT EXISTS idx_raw_rcg_periodo ON raw.ratio_capital_global (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_rcg_empresa ON raw.ratio_capital_global (empresa);

COMMENT ON TABLE raw.ratio_capital_global IS
    'Ratio de Capital Global (Basilea III) por entidad. RCG = Patrimonio Efectivo / APR Total. Minimo regulatorio: 10%.';


-- ---------- PERSONAL ----------
CREATE TABLE IF NOT EXISTS raw.personal_observacion (
    id                  BIGSERIAL PRIMARY KEY,
    periodo             INT  NOT NULL,
    fecha_cierre        DATE NOT NULL,

    empresa_sbs         TEXT NOT NULL,                    -- nombre SBS original
    empresa_bd          TEXT,                             -- nombre normalizado en BD
    tipo_entidad        TEXT NOT NULL,
    microfinanciera     TEXT,                             -- SI / NO
    nacional            TEXT,                             -- SI / NO
    mayor_50_pct_mype   TEXT,

    -- Headcount
    gerentes            INT,
    funcionarios        INT,
    empleados           INT,
    otros               INT,
    total               INT,

    source              TEXT NOT NULL DEFAULT 'base_personal',
    source_file         TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT raw_personal_unique UNIQUE (periodo, empresa_sbs)
);
CREATE INDEX IF NOT EXISTS idx_raw_per_periodo ON raw.personal_observacion (periodo);
CREATE INDEX IF NOT EXISTS idx_raw_per_empresa ON raw.personal_observacion (empresa_sbs);

COMMENT ON TABLE raw.personal_observacion IS
    'Numero de personal por entidad y categoria (Gerentes/Funcionarios/Empleados/Otros).';


-- ---------- MARTS ----------

DROP MATERIALIZED VIEW IF EXISTS marts.mv_indicadores_prudenciales CASCADE;
CREATE MATERIALIZED VIEW marts.mv_indicadores_prudenciales AS
SELECT
    COALESCE(p.periodo, l.periodo, r.periodo)             AS periodo,
    COALESCE(p.fecha_cierre, l.fecha_cierre, r.fecha_cierre) AS fecha_cierre,
    COALESCE(p.empresa, l.empresa, r.empresa)             AS empresa,
    COALESCE(p.tipo_entidad, l.tipo_entidad, r.tipo_entidad) AS tipo_entidad,
    -- Patrimonio
    p.pe_total                                            AS patrimonio_efectivo_total,
    p.nivel_1_pct                                         AS pe_nivel_1_pct,
    p.pe_nivel_1_soles                                    AS pe_nivel_1_soles,
    -- Liquidez
    l.rl_mn                                               AS ratio_liquidez_mn,
    l.rl_me                                               AS ratio_liquidez_me,
    -- RCG
    r.rcg_pct                                             AS rcg,
    r.apr_total                                           AS apr_total,
    r.apr_total_adic                                      AS apr_total_adicional,
    -- Orden canonico
    CASE COALESCE(p.tipo_entidad, l.tipo_entidad, r.tipo_entidad)
        WHEN 'BANCOS' THEN 1
        WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3
        WHEN 'CRAC' THEN 4
        WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.patrimonio_efectivo p
FULL OUTER JOIN raw.ratio_liquidez l
    ON p.periodo = l.periodo AND p.empresa = l.empresa
FULL OUTER JOIN raw.ratio_capital_global r
    ON COALESCE(p.periodo, l.periodo) = r.periodo
   AND COALESCE(p.empresa, l.empresa) = r.empresa;

CREATE UNIQUE INDEX idx_mv_indicadores_unique
    ON marts.mv_indicadores_prudenciales (periodo, empresa);
CREATE INDEX idx_mv_indicadores_periodo ON marts.mv_indicadores_prudenciales (periodo);


DROP MATERIALIZED VIEW IF EXISTS marts.mv_personal_resumen CASCADE;
CREATE MATERIALIZED VIEW marts.mv_personal_resumen AS
SELECT
    periodo, fecha_cierre,
    empresa_sbs, empresa_bd, tipo_entidad,
    microfinanciera, nacional,
    COALESCE(gerentes, 0)     AS gerentes,
    COALESCE(funcionarios, 0) AS funcionarios,
    COALESCE(empleados, 0)    AS empleados,
    COALESCE(otros, 0)        AS otros,
    COALESCE(total, 0)        AS total,
    CASE tipo_entidad
        WHEN 'BANCOS' THEN 1
        WHEN 'FINANCIERAS' THEN 2
        WHEN 'CMAC' THEN 3
        WHEN 'CRAC' THEN 4
        WHEN 'EDPYMES' THEN 5
        ELSE 9
    END AS orden_tipo
FROM raw.personal_observacion;

CREATE UNIQUE INDEX idx_mv_personal_unique
    ON marts.mv_personal_resumen (periodo, empresa_sbs);
CREATE INDEX idx_mv_personal_periodo ON marts.mv_personal_resumen (periodo);
