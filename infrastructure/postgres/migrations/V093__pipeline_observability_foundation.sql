-- =========================================================================
-- V093: Pipeline Observability V1 — Foundation (issue #18)
--
-- Cierra G1+G2+G3 del audit de observabilidad (docs/design/pipeline-observability-v1.md):
--
--   G1: importers no actualizaban raw.archivos_descargados.status='procesado'
--       → ahora el wrapper _import_with_audit hace UPDATE al terminar.
--
--   G2: raw.carga_log (V007) declarada pero sin uso real.
--       → agregamos columnas (stage, topico, periodo, archivo_id, etc) +
--         GENERATED duration_seconds. Mantiene compatibilidad con V007.
--
--   G3: aibenchef catalog detectar-cambios solo manual, output no persistido.
--       → nueva tabla admin.estructura_diffs para guardar runs automatizados.
--
-- Migracion 100% aditiva. Rollback = DROP TABLE admin.estructura_diffs +
-- ALTER raw.carga_log DROP COLUMN <nuevas>. Sin breaking changes.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Extender raw.carga_log (V007) con campos de observabilidad estructurada
-- -------------------------------------------------------------------------

-- stage: identifica qué etapa del pipeline corrió.
--   'scrape'           — descarga de archivos SBS
--   'import'           — parseo + insert a raw.<topico>_observacion
--   'refresh-mvs'      — REFRESH MATERIALIZED VIEW
--   'detectar-cambios' — análisis estructural xls vs cabecera_maestra
--   'backfill'         — operaciones one-off de re-procesado masivo
ALTER TABLE raw.carga_log
    ADD COLUMN IF NOT EXISTS stage TEXT;

-- topico: 'eeff', 'oficinas', 'depositos', etc. NULL para refresh-mvs global.
ALTER TABLE raw.carga_log
    ADD COLUMN IF NOT EXISTS topico TEXT;

-- periodo: YYYYMM al que aplica la corrida. NULL si no aplica (ej. detectar-cambios all).
ALTER TABLE raw.carga_log
    ADD COLUMN IF NOT EXISTS periodo INTEGER;

-- archivo_id: link al archivo específico procesado, si aplica.
ALTER TABLE raw.carga_log
    ADD COLUMN IF NOT EXISTS archivo_id UUID;

-- triggered_by: quién disparó esta corrida.
--   'cron'            — workflow GitHub Actions mensual
--   'manual:<email>'  — admin desde dashboard
--   'cli:<user>'      — invocación directa del binario aibenchef
ALTER TABLE raw.carga_log
    ADD COLUMN IF NOT EXISTS triggered_by TEXT;

-- sync_job_id: correlación con admin.sync_jobs cuando el origen fue ese flujo.
-- BIGINT porque admin.sync_jobs.id es BIGSERIAL (V075).
ALTER TABLE raw.carga_log
    ADD COLUMN IF NOT EXISTS sync_job_id BIGINT;

-- FK opcional al archivo. ON DELETE SET NULL para no perder historia si
-- en el futuro alguien limpia archivos huerfanos.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_carga_log_archivo'
    ) THEN
        ALTER TABLE raw.carga_log
            ADD CONSTRAINT fk_carga_log_archivo
            FOREIGN KEY (archivo_id) REFERENCES raw.archivos_descargados(id)
            ON DELETE SET NULL;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_carga_log_sync_job'
    ) THEN
        ALTER TABLE raw.carga_log
            ADD CONSTRAINT fk_carga_log_sync_job
            FOREIGN KEY (sync_job_id) REFERENCES admin.sync_jobs(id)
            ON DELETE SET NULL;
    END IF;
END$$;

-- Indices para queries del dashboard.
CREATE INDEX IF NOT EXISTS idx_carga_log_stage_periodo
    ON raw.carga_log (stage, periodo DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_carga_log_status_failed
    ON raw.carga_log (started_at DESC)
    WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_carga_log_archivo_id
    ON raw.carga_log (archivo_id)
    WHERE archivo_id IS NOT NULL;

COMMENT ON COLUMN raw.carga_log.stage IS
    'Etapa del pipeline: scrape | import | refresh-mvs | detectar-cambios | backfill';
COMMENT ON COLUMN raw.carga_log.topico IS
    'Tópico SBS (eeff, oficinas, depositos, ...). NULL para refresh-mvs global.';
COMMENT ON COLUMN raw.carga_log.periodo IS
    'Periodo YYYYMM al que aplica. NULL para corridas all-periods.';
COMMENT ON COLUMN raw.carga_log.archivo_id IS
    'FK a raw.archivos_descargados.id si la corrida procesó un archivo específico.';
COMMENT ON COLUMN raw.carga_log.triggered_by IS
    'Origen: cron | manual:<email> | cli:<user>';
COMMENT ON COLUMN raw.carga_log.sync_job_id IS
    'FK a admin.sync_jobs.id si la corrida vino del flujo sync-sbs del dashboard.';

-- -------------------------------------------------------------------------
-- 2) Nueva tabla admin.estructura_diffs — persiste output de detectar-cambios
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin.estructura_diffs (
    id            BIGSERIAL PRIMARY KEY,

    -- Qué se analizó
    periodo       INTEGER NOT NULL,
    grupo         TEXT    NOT NULL,        -- BANCOS, CMAC, FIN, CRAC, EDPYME, ...
    topico        TEXT    NOT NULL,        -- eeff, oficinas, ...
    tipo_estado   TEXT,                    -- balance | resultados (NULL si no aplica)

    -- Cuándo se detectó
    detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    carga_log_id  BIGINT REFERENCES raw.carga_log(id) ON DELETE SET NULL,

    -- Resumen numérico
    n_renames     INTEGER NOT NULL DEFAULT 0,
    n_extras      INTEGER NOT NULL DEFAULT 0,
    n_missing     INTEGER NOT NULL DEFAULT 0,

    -- Severidad para alertas
    severity      TEXT NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info', 'warning', 'critical')),

    -- Detalle estructurado: {renames: [{orden, nombre_archivo, nombre_cabecera}],
    --                        extras: [{orden, nombre_archivo}],
    --                        missing: [{orden, codigo, nombre_cabecera}]}
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Workflow de revisión humana
    reviewed_at   TIMESTAMPTZ,
    reviewed_by   TEXT,                    -- email del admin
    review_action TEXT,                    -- 'ignored' | 'cabecera_updated' |
                                            -- 'rename_added' | 'falsa_alarma' | ...
    review_notes  TEXT
);

-- Una corrida del detector por (periodo, grupo, topico, tipo_estado, instante).
-- Multiples corridas para el mismo periodo son válidas (re-runs).
CREATE INDEX IF NOT EXISTS idx_estructura_diffs_periodo
    ON admin.estructura_diffs (periodo DESC, grupo, topico);

CREATE INDEX IF NOT EXISTS idx_estructura_diffs_unreviewed
    ON admin.estructura_diffs (detected_at DESC)
    WHERE reviewed_at IS NULL AND severity != 'info';

CREATE INDEX IF NOT EXISTS idx_estructura_diffs_severity
    ON admin.estructura_diffs (severity, detected_at DESC)
    WHERE severity != 'info';

COMMENT ON TABLE admin.estructura_diffs IS
    'Persiste output de aibenchef catalog detectar-cambios. Cada fila = un
     análisis estructural de un archivo SBS contra dw.cabecera_maestra.
     Útil para detectar drift de SBS (filas extra, renames, faltantes) y
     decidir si la cabecera_maestra necesita actualización. Issue #18.';

COMMENT ON COLUMN admin.estructura_diffs.severity IS
    'info     = diffs esperados (renames ya canonizados en entidad_maestra)
     warning  = diff que requiere revisión humana (rename desconocido, footnote extra)
     critical = diff que probablemente rompe la ingesta (>10 extras, >5 missing en cuentas core)';

COMMENT ON COLUMN admin.estructura_diffs.payload IS
    'JSONB con detalle:
     {
       "renames":  [{"orden": N, "archivo": "...", "cabecera": "..."}],
       "extras":   [{"orden": N, "archivo": "..."}],
       "missing":  [{"orden": N, "codigo": "...", "cabecera": "..."}],
       "metadata": {"file_path": "...", "sheets": [...]}
     }';
