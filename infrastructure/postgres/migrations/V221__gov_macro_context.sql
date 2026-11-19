-- V221__gov_macro_context.sql
-- Snapshots del contexto macro vigente del sistema financiero peruano.
-- Alimenta los analisis de IA con eventos reales en curso: Niño en emergencia,
-- tasas BCR, cambios regulatorios SBS, ciclo electoral, etc.
--
-- Diferencia con el bloque estatico de sector-knowledge.ts: ese es texto
-- hardcodeado en el prompt (no se actualiza). Esta tabla se refresca via
-- script scripts/refresh_macro_context.ts (manual o por cron) usando
-- Claude + web_search para traer la data viva.

CREATE SCHEMA IF NOT EXISTS gov;

CREATE TABLE IF NOT EXISTS gov.macro_context (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    categoria        TEXT NOT NULL CHECK (categoria IN (
        'climatico',    -- Niño, friajes, sequias, inundaciones
        'macro',        -- tasas BCR, inflacion, crecimiento PBI, cambiario
        'politico',     -- elecciones, crisis social, conflicto politico
        'regulatorio',  -- circulares SBS, nuevas leyes, cambios normativos
        'sectorial'     -- consolidaciones, eventos del sistema financiero
    )),
    titulo           TEXT NOT NULL,          -- "Fenomeno El Niño 2026 en curso"
    resumen          TEXT NOT NULL,          -- 1-3 oraciones con cifras duras
    impacto          TEXT,                   -- "cartera microempresa y agraria mas expuestas"
    severidad        TEXT NOT NULL CHECK (severidad IN ('alta','media','baja','informativo')),
    vigente_hasta    DATE,                    -- fecha estimada hasta la que es relevante
    fuentes          TEXT[],
    research_model   TEXT,
    research_cost_usd NUMERIC(10,6) DEFAULT 0,
    verified_by_human BOOLEAN NOT NULL DEFAULT false,
    verified_by      TEXT,
    verified_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_macro_context_vigente
    ON gov.macro_context (vigente_hasta DESC NULLS LAST, categoria);
CREATE INDEX IF NOT EXISTS idx_macro_context_snapshot
    ON gov.macro_context (snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_macro_context_severidad
    ON gov.macro_context (severidad, vigente_hasta DESC NULLS LAST);

-- Trigger de updated_at — reusa la funcion de V220
DROP TRIGGER IF EXISTS trg_macro_context_updated_at ON gov.macro_context;
CREATE TRIGGER trg_macro_context_updated_at
    BEFORE UPDATE ON gov.macro_context
    FOR EACH ROW
    EXECUTE FUNCTION gov.set_updated_at();

-- Tabla de tracking de refreshes del snapshot. Permite ver cuando fue el
-- ultimo refresh completo y cuanto costo.
CREATE TABLE IF NOT EXISTS gov.macro_context_refresh_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    items_created    INTEGER DEFAULT 0,
    items_updated    INTEGER DEFAULT 0,
    items_expired    INTEGER DEFAULT 0,   -- items marcados vigente_hasta <= hoy
    cost_usd         NUMERIC(10,6) DEFAULT 0,
    status           TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
    error            TEXT,
    triggered_by     TEXT                   -- email del admin o 'cron'
);

COMMENT ON TABLE gov.macro_context IS
    'Snapshots del contexto macro vigente (Niño, tasas, regulatorio, politico) usados por los analisis de IA para aterrizar la narrativa en el momento real.';
COMMENT ON TABLE gov.macro_context_refresh_log IS
    'Log de cada refresh del snapshot macro. Util para auditoria y debugging.';
