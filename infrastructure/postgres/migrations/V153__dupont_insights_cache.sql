-- V153 — Cache persistente cross-user de insights DuPont generados por LLM
--
-- Contexto: el endpoint /api/v1/dupont/insights genera narrativa con
-- Claude para las 4 secciones del DuPont. Actualmente cachea in-memory
-- (30min, LRU 200 entradas por-contenedor). Problemas:
--   - Se pierde en cada deploy (todos los usuarios post-deploy pagan
--     tokens fresh).
--   - No compartido cross-user: 2 usuarios distintos con los mismos
--     defaults pagan 2 llamadas al LLM.
--   - No compartido cross-contenedor (si escalamos horizontal).
--
-- V153 crea tabla persistente para cache cross-user cross-contenedor
-- cross-deploy. Reduce costos LLM drasticamente porque los defaults
-- (peer group estandar) se generan 1 sola vez para todos.
--
-- Key: hash SHA256 del input (entidades + periodos + valores redondeados).
-- Idempotente en el schema — CREATE TABLE IF NOT EXISTS.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.dupont_insights_cache (
    input_hash      TEXT PRIMARY KEY,
    insights        JSONB NOT NULL,
    model           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    cost_usd        NUMERIC(10, 6),
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_hit_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    hit_count       INTEGER NOT NULL DEFAULT 1
);

-- Indice para cleanup por edad (borrar entradas viejas si la tabla crece)
CREATE INDEX IF NOT EXISTS idx_dupont_insights_cache_generated
    ON app.dupont_insights_cache (generated_at);

-- Indice para busqueda por hit count (analytics: cuales son los peer
-- groups mas consultados)
CREATE INDEX IF NOT EXISTS idx_dupont_insights_cache_hits
    ON app.dupont_insights_cache (hit_count DESC);

COMMENT ON TABLE app.dupont_insights_cache IS
    'Cache persistente cross-user de narrativa IA (Claude) del /dashboard/dupont. Reduce costos LLM: la primera vez que alguien consulta unos defaults se genera; todos los siguientes usuarios comparten el resultado.';

COMMENT ON COLUMN app.dupont_insights_cache.input_hash IS
    'SHA256 del input (entidades sorted + periodos sorted + valores redondeados a 2 decimales). Truncado a 32 chars para performance.';

COMMENT ON COLUMN app.dupont_insights_cache.insights IS
    'JSONB { roe: string[], roa: string[], mon: string[], mfb: string[] } — bullets para las 4 secciones del DuPont.';

COMMENT ON COLUMN app.dupont_insights_cache.hit_count IS
    'Cuantas veces se sirvio de cache (excluye la primera generacion). Analytics para identificar peer groups populares.';

-- =========================================================================
-- Funcion helper: upsert de cache hit (incrementa contador + updated_at)
-- Se llama desde el endpoint cuando hay cache hit. Idempotente y atomica.
-- =========================================================================
CREATE OR REPLACE FUNCTION app.dupont_insights_touch(_hash TEXT)
RETURNS VOID AS $fn$
BEGIN
    UPDATE app.dupont_insights_cache
    SET hit_count = hit_count + 1,
        last_hit_at = now()
    WHERE input_hash = _hash;
END;
$fn$ LANGUAGE plpgsql;

COMMENT ON FUNCTION app.dupont_insights_touch(TEXT) IS
    'Marca un hit del cache: incrementa hit_count + actualiza last_hit_at.';
