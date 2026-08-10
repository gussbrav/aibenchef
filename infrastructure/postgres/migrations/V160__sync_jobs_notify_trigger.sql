-- =========================================================================
-- V160 — TRIGGER pg_notify para admin.sync_jobs
--
-- CONTEXTO: hasta hoy, los sync_jobs pending se procesaban por cron
-- (aibenchef-work-jobs cada 5 min, o aibenchef-daily-sync 3x/dia). Latencia
-- desde "user encola desde /admin/data-quality" hasta "worker descarga
-- archivo" era 5 min a 8 horas.
--
-- V160 introduce el patron LISTEN/NOTIFY: cada INSERT en admin.sync_jobs
-- dispara pg_notify('sync_jobs', payload). Un daemon Python en el container
-- aibenchef-data hace LISTEN al canal y procesa el job en <1 segundo.
--
-- Beneficios vs cron:
--   1. Latencia sub-segundo (cron minimo era 5 min).
--   2. Cero polling overhead cuando no hay jobs (cron corria vacio).
--   3. Cero configuracion de infra (cron requeria SSH al host EasyPanel).
--   4. Sobrevive escalamiento horizontal (multiples daemons LISTEN al mismo
--      canal, PostgreSQL entrega el evento a todos).
--
-- FALLBACK: el cron sigue existiendo como safety net. Si el daemon muere
-- (bug, OOM, restart en curso), el proximo cron toma los jobs pending.
-- Belt-and-suspenders.
--
-- PAYLOAD: JSON con {id, periodo_desde, periodo_hasta, force_redownload}
-- para que el daemon pueda filtrar sin hacer SELECT si quiere. Se limita a
-- 8000 chars (limite PostgreSQL de NOTIFY payload).
-- =========================================================================

CREATE OR REPLACE FUNCTION admin.notify_sync_job_inserted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Solo notificamos INSERTs con status='pending' (cero ruido en cambios
    -- de status via UPDATE — el worker gestiona el ciclo internamente).
    IF NEW.status = 'pending' THEN
        PERFORM pg_notify(
            'sync_jobs',
            json_build_object(
                'id', NEW.id,
                'periodo_desde', NEW.periodo_desde,
                'periodo_hasta', NEW.periodo_hasta,
                'force_redownload', COALESCE(NEW.force_redownload, false),
                'triggered_by', NEW.triggered_by
            )::text
        );
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION admin.notify_sync_job_inserted IS
    'V160: dispara pg_notify(''sync_jobs'', <json_payload>) en cada INSERT '
    'de admin.sync_jobs con status=pending. Consumido por el worker daemon '
    'de aibenchef-data (worker_daemon.py) para procesar inmediatamente '
    'sin esperar el cron.';


-- Trigger AFTER INSERT — se dispara UNA VEZ por INSERT (no por UPDATE).
DROP TRIGGER IF EXISTS trg_sync_jobs_notify ON admin.sync_jobs;
CREATE TRIGGER trg_sync_jobs_notify
    AFTER INSERT ON admin.sync_jobs
    FOR EACH ROW
    EXECUTE FUNCTION admin.notify_sync_job_inserted();

COMMENT ON TRIGGER trg_sync_jobs_notify ON admin.sync_jobs IS
    'V160: notifica al worker daemon en cada nuevo sync_job pending. '
    'Reduce latencia de procesamiento de minutos/horas a <1 segundo.';
