"""Worker daemon — LISTEN a admin.sync_jobs, procesa jobs pending.

REEMPLAZO PROFESIONAL DEL CRON:

Antes: cron `aibenchef sbs work-jobs` cada 5 min → latencia 5 min.
Ahora: daemon LISTEN al canal Postgres 'sync_jobs' → latencia <1 seg.

FLUJO:
    1. Startup: procesa cualquier sync_job pending pre-existente (recovery
       tras restart/OOM).
    2. LISTEN sync_jobs — canal que el trigger V160 popula en cada INSERT.
    3. Loop: espera notifies. Cada notify → subprocess `aibenchef sbs
       work-jobs --max-jobs 10`. Debounce 2 seg (multiples notifies en
       rafaga procesan UNA vez).
    4. Reintenta reconexion si la DB se cae (exponential backoff).

RUN:
    python -m aibenchef_data.worker_daemon

En el container, se arranca en background por entrypoint.sh — corre
paralelo al `tail -f /dev/null` (que sigue siendo PID 1 para que docker
exec siga funcionando igual).
"""

from __future__ import annotations

import contextlib
import json
import subprocess
import sys
import threading
import time
from datetime import datetime
from typing import Any

import psycopg

from aibenchef_data.domains.shared import get_logger
from aibenchef_data.env import settings

log = get_logger(__name__)

CHANNEL = "sync_jobs"
DEBOUNCE_SEC = 2.0  # Colapsa notifies en rafaga a 1 sola ejecucion
MAX_JOBS_PER_RUN = 10  # Igual que el cron
RECONNECT_MIN_SEC = 1.0
RECONNECT_MAX_SEC = 60.0


def _run_work_jobs(reason: str) -> None:
    """Invoca el CLI `aibenchef sbs work-jobs` como subprocess.

    Usar subprocess (no import directo) porque el comando click es sync
    y hace conexiones/commits propios — mezclarlo con el loop async del
    daemon es propenso a deadlocks. subprocess es hermetico.
    """
    log.info("worker.run_start", reason=reason, max_jobs=MAX_JOBS_PER_RUN)
    t0 = time.time()
    try:
        result = subprocess.run(
            ["aibenchef", "sbs", "work-jobs", "--max-jobs", str(MAX_JOBS_PER_RUN)],
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min — jobs pesados de re-import pueden tardar
        )
        duration = time.time() - t0
        if result.returncode == 0:
            log.info(
                "worker.run_ok",
                duration_sec=round(duration, 2),
                stdout_tail=result.stdout[-500:] if result.stdout else "",
            )
        else:
            log.error(
                "worker.run_failed",
                duration_sec=round(duration, 2),
                returncode=result.returncode,
                stderr_tail=result.stderr[-500:] if result.stderr else "",
            )
    except subprocess.TimeoutExpired:
        log.error("worker.run_timeout", duration_sec=round(time.time() - t0, 2))
    except Exception as e:
        log.error("worker.run_exception", error=str(e))


def _recover_pending_jobs(conn: psycopg.Connection) -> None:
    """Startup recovery: procesa jobs pending que quedaron de antes del
    startup del daemon (crash previo, restart, primera vez que corre).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM admin.sync_jobs WHERE status = 'pending'")
        row = cur.fetchone()
        n_pending = row[0] if row else 0
    if n_pending > 0:
        log.info("worker.recovery_start", n_pending=n_pending)
        _run_work_jobs(reason=f"startup_recovery:{n_pending}")
    else:
        log.info("worker.recovery_skip", n_pending=0)


class Debouncer:
    """Colapsa multiples eventos en un solo run.

    Uso:
      d = Debouncer(callback, 2.0)
      d.trigger()  # arranca timer de 2s
      d.trigger()  # cancela + reinicia timer
      # ... a los 2s sin mas triggers, corre callback UNA vez
    """

    def __init__(self, callback: Any, delay_sec: float) -> None:
        self._callback = callback
        self._delay = delay_sec
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def trigger(self, *args: Any, **kwargs: Any) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._delay, self._callback, args=args, kwargs=kwargs)
            self._timer.daemon = True
            self._timer.start()


def _listen_loop() -> None:
    """Loop principal: LISTEN al canal, procesar en cada notify (debounced).

    Reconecta con exponential backoff si la conexion se cae.
    """
    debouncer = Debouncer(lambda: _run_work_jobs(reason="notify_debounced"), DEBOUNCE_SEC)
    backoff = RECONNECT_MIN_SEC
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    while True:
        try:
            # autocommit=True es OBLIGATORIO para LISTEN (los NOTIFY se
            # entregan solo cuando la txn commitea).
            with psycopg.connect(url, autocommit=True, connect_timeout=10) as conn:
                # Recovery al arranque de la conexion
                _recover_pending_jobs(conn)

                with conn.cursor() as cur:
                    cur.execute(f"LISTEN {CHANNEL}")
                log.info("worker.listening", channel=CHANNEL)
                backoff = RECONNECT_MIN_SEC  # reset backoff en conexion exitosa

                # Bloqueante: iterador de notifies. Sale si la conn se cae.
                gen = conn.notifies()
                for notify in gen:
                    payload: dict[str, Any] = {}
                    with contextlib.suppress(json.JSONDecodeError):
                        payload = json.loads(notify.payload) if notify.payload else {}
                    log.info(
                        "worker.notify_received",
                        pid=notify.pid,
                        channel=notify.channel,
                        job_id=payload.get("id"),
                        periodo=payload.get("periodo_desde"),
                    )
                    # Debounce: si llegan 5 notifies en 500ms (ej.
                    # recheck-stale encola 5 periodos), corremos UNA vez
                    # el work-jobs en vez de 5 subprocess concurrentes.
                    debouncer.trigger()
        except (psycopg.OperationalError, psycopg.InterfaceError) as e:
            log.warning(
                "worker.connection_lost",
                error=str(e),
                reconnect_in_sec=backoff,
            )
            time.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_SEC)
        except KeyboardInterrupt:
            log.info("worker.shutdown", reason="keyboard_interrupt")
            return
        except Exception as e:
            log.error("worker.unexpected_error", error=str(e), reconnect_in_sec=backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_SEC)


def main() -> int:
    log.info(
        "worker.startup",
        channel=CHANNEL,
        debounce_sec=DEBOUNCE_SEC,
        max_jobs_per_run=MAX_JOBS_PER_RUN,
        started_at=datetime.utcnow().isoformat(),
    )
    _listen_loop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
