-- =========================================================================
-- V075: Cola de jobs de sincronización SBS.
--
-- Permite al dashboard admin disparar manualmente (boton "Sincronizar SBS")
-- la descarga de archivos para un periodo + el cron mensual programado.
--
-- Flow:
--   1. Dashboard POST /api/v1/admin/sync-sbs -> insert con status='pending'
--   2. Worker CLI 'aibenchef sbs work-jobs' (corrido por cron) toma el job,
--      ejecuta scrape + storage-scan + imports
--   3. Worker actualiza status -> 'running' -> 'completed' / 'failed' + log
--   4. Dashboard polea status y muestra progreso
-- =========================================================================

CREATE SCHEMA IF NOT EXISTS admin;

CREATE TABLE IF NOT EXISTS admin.sync_jobs (
    id              BIGSERIAL PRIMARY KEY,
    -- Que sincronizar
    periodo_desde   INT NOT NULL,                      -- YYYYMM
    periodo_hasta   INT NOT NULL,                      -- YYYYMM (inclusivo)
    topicos         TEXT[],                            -- NULL = todos
    grupos          TEXT[],                            -- NULL = todos
    -- Estado
    status          TEXT NOT NULL DEFAULT 'pending'    -- pending | running | completed | failed
                    CHECK (status IN ('pending','running','completed','failed','cancelled')),
    -- Resultados
    archivos_descargados  INT,
    archivos_cambiados    INT,                         -- md5 diferente al previo
    filas_importadas      INT,
    log_text              TEXT,                        -- log abreviado
    error_mensaje         TEXT,
    -- Audit
    triggered_by    TEXT NOT NULL DEFAULT 'manual',    -- 'manual' | 'cron'
    triggered_by_email TEXT,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    -- duracion en segundos (calculada)
    duracion_seg    INT GENERATED ALWAYS AS (
        CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (completed_at - started_at))::int
             ELSE NULL END
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_requested
    ON admin.sync_jobs (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_pending
    ON admin.sync_jobs (requested_at) WHERE status = 'pending';

COMMENT ON TABLE admin.sync_jobs IS
    'Cola de jobs de sincronizacion SBS. El worker CLI aibenchef sbs work-jobs '
    'consume los pending. El dashboard admin tiene un boton que inserta nuevos.';
