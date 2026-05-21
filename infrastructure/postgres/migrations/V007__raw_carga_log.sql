-- =========================================================================
-- V007: Audit log de cargas a raw.* (idempotencia + observabilidad)
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.carga_log (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL,
    source_file     TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed')),
    rows_inserted   INT NOT NULL DEFAULT 0,
    rows_updated    INT NOT NULL DEFAULT 0,
    rows_skipped    INT NOT NULL DEFAULT 0,
    error_message   TEXT,
    metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_carga_log_source ON raw.carga_log (source);
CREATE INDEX IF NOT EXISTS idx_carga_log_started ON raw.carga_log (started_at DESC);

COMMENT ON TABLE raw.carga_log IS
    'Audit log de cada corrida del importer / scraper. Util para '
    'idempotencia y debugging.';
