-- V220__gov_entity_profiles.sql
-- Perfiles de entidad del sistema financiero / COOPAC para enriquecer el
-- contexto de los analisis de IA. Guarda ubicacion, publico objetivo real,
-- modelo de negocio, segmento de cartera, etc. — datos que la data SBS no
-- contiene pero que son criticos para que el LLM no invente ni se disculpe.
--
-- Fuente: investigacion automatica via Claude API con web_search tool
-- habilitado (ver apps/web/lib/domains/governance/entity-profiles/research.ts).
-- Los perfiles se generan on-demand al analizar una entidad nueva.
-- Rate limit: 20 researches / dia global para control de costo.
--
-- Validacion: los perfiles nacen con verified_by_human = false ("preliminar").
-- Gustavo / JJ pueden editar y marcar verified_by_human = true desde el admin UI.

CREATE SCHEMA IF NOT EXISTS gov;

CREATE TABLE IF NOT EXISTS gov.entity_profiles (
    nomb_correg                 TEXT PRIMARY KEY,
    tipo_entidad                TEXT,                     -- snapshot del tipo al momento de research (BANCOS, COOPAC_N1, etc)
    ubicacion                   TEXT,                     -- "Arequipa, Peru" | "Lima" | "nacional" | null
    inicio_operaciones          TEXT,                     -- "2018-12" | "1995" | null
    ruc_sunat                   TEXT,
    publico_objetivo            TEXT,                     -- "Trabajadores publicos (CAS/nombrado) + convenios" | "Microempresa Lima Sur" | ...
    modelo_negocio              TEXT CHECK (modelo_negocio IN ('cerrada','abierta','mixta','desconocido') OR modelo_negocio IS NULL),
    segmento_cartera_hipotesis  TEXT,                     -- "consumo con descuento planilla" | "microempresa retail" | ...
    productos_principales       TEXT,                     -- "ahorros, creditos convenio, DPF" | "creditos grupales, ahorros"
    notas                       TEXT,                     -- texto libre: info adicional util
    fuentes                     TEXT[],                   -- URLs consultadas (facebook, SBS, prensa, etc)

    -- Metadata del research
    research_at                 TIMESTAMPTZ,              -- cuando se investigo (ultima vez)
    research_model              TEXT,                     -- "claude-sonnet-4-6 + web_search_20250305"
    research_cost_usd           NUMERIC(10,6) DEFAULT 0,  -- costo acumulado de todas las investigaciones
    research_count              INTEGER DEFAULT 0,        -- cuantas veces se investigo (para tracking)

    -- Validacion humana
    verified_by_human           BOOLEAN NOT NULL DEFAULT false,
    verified_by                 TEXT,                     -- email del validador
    verified_at                 TIMESTAMPTZ,

    -- Tracking de uso (para priorizar re-research de las mas usadas)
    use_count                   INTEGER NOT NULL DEFAULT 0,
    last_used_at                TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices para los flujos de uso principales
CREATE INDEX IF NOT EXISTS idx_entity_profiles_tipo
    ON gov.entity_profiles (tipo_entidad);
CREATE INDEX IF NOT EXISTS idx_entity_profiles_verified
    ON gov.entity_profiles (verified_by_human, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_profiles_last_used
    ON gov.entity_profiles (last_used_at DESC NULLS LAST);

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION gov.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entity_profiles_updated_at ON gov.entity_profiles;
CREATE TRIGGER trg_entity_profiles_updated_at
    BEFORE UPDATE ON gov.entity_profiles
    FOR EACH ROW
    EXECUTE FUNCTION gov.set_updated_at();

-- Tabla auxiliar para rate limiting del research global
-- Una fila por dia; se incrementa cada vez que se dispara un research exitoso.
-- Si el counter del dia >= LIMITE_DIARIO, no se investigan nuevas entidades
-- hasta el dia siguiente.
CREATE TABLE IF NOT EXISTS gov.entity_research_daily_usage (
    fecha_utc                   DATE PRIMARY KEY,
    research_count              INTEGER NOT NULL DEFAULT 0,
    total_cost_usd              NUMERIC(10,6) NOT NULL DEFAULT 0,
    last_research_at            TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comentarios para documentacion
COMMENT ON TABLE gov.entity_profiles IS
    'Perfiles de entidad financiera/COOPAC generados por research automatico con Claude + web_search. Enriquecen el contexto de los analisis de IA para evitar especulacion o disculpas del modelo.';
COMMENT ON COLUMN gov.entity_profiles.verified_by_human IS
    'Si true, el perfil fue revisado y aprobado por un admin. Los no verificados se usan pero el prompt los califica como "informacion preliminar".';
COMMENT ON TABLE gov.entity_research_daily_usage IS
    'Rate limit diario del research global. Topeado en 20/dia por defecto (ver RESEARCH_DAILY_LIMIT en el domain).';
