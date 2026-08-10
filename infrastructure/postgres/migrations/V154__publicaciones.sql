-- =========================================================================
-- V154 — Publicaciones: articulos long-form generados por AI para LinkedIn
--
-- OBJETIVO: nuevo modulo /dashboard/publicaciones donde el usuario
-- selecciona un tema (benchmarking, coyuntura macro, DuPont, evolucion
-- PE), la data del cliente + periodo, y el LLM genera un articulo de
-- 400-800 palabras estilo editorial (New York Times / Hermes Holguin /
-- Jesus Ferreyra). El usuario edita el draft, revisa, y copia a
-- LinkedIn con hashtags precargados.
--
-- DIFERENCIA CON admin.report_insights (V141):
--   - insights: bullets cortos (5-7 items, 2-4 lineas c/u), cacheados
--     cross-user por (periodo, seccion, peer_group).
--   - publicaciones: articulos long-form (400-800 palabras, prosa
--     continua), PROPIEDAD del usuario que los crea. Cada draft es
--     unico — no hay cache cross-user (cada usuario edita el suyo).
--
-- WORKFLOW:
--   1. draft: recien generado por LLM, el usuario puede editar.
--   2. reviewed: el usuario reviso y esta ok para publicar.
--   3. published: marcado como publicado en LinkedIn (fecha registrada).
--   4. archived: descartado — no se muestra por default.
--
-- COST TRACKING:
-- Usa la infraestructura de rate limit existente (V141
-- admin.check_insights_rate_limit) — publicaciones cuentan igual que
-- insights. Trade-off: menos control granular, pero mucho menos codigo
-- duplicado.
-- =========================================================================

-- ============ 1. Tabla principal ============
CREATE TABLE IF NOT EXISTS admin.publicaciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tema (define que prompt template se uso)
    tema                TEXT NOT NULL
                        CHECK (tema IN (
                            'benchmarking_sectorial',
                            'coyuntura_macro',
                            'dupont_rentabilidad',
                            'evolucion_pe_segmento'
                        )),

    -- Contenido
    titulo              TEXT NOT NULL,
    contenido_md        TEXT NOT NULL,           -- markdown, editable por el user
    hashtags            TEXT[] NOT NULL DEFAULT '{}',

    -- Contexto de la generacion (para regenerar si el user quiere)
    cliente_slug        TEXT REFERENCES config.cliente(slug) ON DELETE SET NULL,
    periodo             INT NOT NULL,
    entidad_propia      TEXT NOT NULL,
    peer_group          TEXT[] NOT NULL DEFAULT '{}',
    contexto_json       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Metadata del LLM
    llm_provider_id     UUID REFERENCES admin.llm_providers(id) ON DELETE SET NULL,
    model               TEXT NOT NULL,
    prompt_version      TEXT NOT NULL DEFAULT 'v1',
    tokens_input        INT NOT NULL DEFAULT 0,
    tokens_output       INT NOT NULL DEFAULT 0,
    cost_usd            NUMERIC(10, 6) NOT NULL DEFAULT 0,
    duration_ms         INT,

    -- Workflow
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'reviewed', 'published', 'archived')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at        TIMESTAMPTZ,
    created_by          TEXT NOT NULL,           -- 'user:email'
    published_by        TEXT                     -- 'user:email' si status=published
);

-- Indices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_publicaciones_created_by
    ON admin.publicaciones (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publicaciones_status
    ON admin.publicaciones (status, updated_at DESC)
    WHERE status <> 'archived';
CREATE INDEX IF NOT EXISTS idx_publicaciones_cliente
    ON admin.publicaciones (cliente_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publicaciones_periodo_tema
    ON admin.publicaciones (periodo DESC, tema);

COMMENT ON TABLE admin.publicaciones IS
    'Articulos long-form generados por LLM para publicacion en LinkedIn. '
    'Cada draft es propiedad del usuario que lo crea (no hay cache '
    'cross-user como en report_insights). Workflow: draft -> reviewed '
    '-> published/archived.';

COMMENT ON COLUMN admin.publicaciones.contenido_md IS
    'Cuerpo del articulo en markdown. El usuario puede editar antes de '
    'marcar como reviewed/published. La UI hace copy-to-clipboard con '
    'formato limpio (sin markdown syntax) para LinkedIn.';

COMMENT ON COLUMN admin.publicaciones.contexto_json IS
    'Data que se le paso al LLM (numeros del cierre, ranking, etc). '
    'Sirve para regenerar el articulo si el user quiere otra version, '
    'sin tener que reconstruir todo el contexto desde las MV.';


-- ============ 2. Trigger para actualizar updated_at ============
CREATE OR REPLACE FUNCTION admin.publicaciones_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publicaciones_touch ON admin.publicaciones;
CREATE TRIGGER trg_publicaciones_touch
    BEFORE UPDATE ON admin.publicaciones
    FOR EACH ROW
    EXECUTE FUNCTION admin.publicaciones_touch_updated_at();


-- ============ 3. Vista con conteos por estado (para el header UI) ============
CREATE OR REPLACE VIEW admin.v_publicaciones_stats AS
SELECT
    COALESCE(created_by, '(sin autor)')  AS autor,
    COUNT(*) FILTER (WHERE status = 'draft')      AS drafts,
    COUNT(*) FILTER (WHERE status = 'reviewed')   AS reviewed,
    COUNT(*) FILTER (WHERE status = 'published')  AS published,
    COUNT(*) FILTER (WHERE status = 'archived')   AS archived,
    COUNT(*)                                       AS total,
    SUM(cost_usd)                                  AS cost_total,
    MAX(created_at)                                AS ultimo_creado
FROM admin.publicaciones
GROUP BY created_by;

COMMENT ON VIEW admin.v_publicaciones_stats IS
    'Estadisticas de publicaciones agrupadas por autor. Consumido desde '
    'el header de /dashboard/publicaciones y desde admin dashboards.';
