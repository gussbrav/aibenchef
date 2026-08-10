#!/bin/bash
# entrypoint.sh — arranca el worker daemon en background + delega al CMD.
#
# El container tiene 2 procesos concurrentes:
#   1. worker_daemon.py (background) — escucha NOTIFY de admin.sync_jobs
#      y procesa los pending en <1 seg de latencia (V160).
#   2. CMD original (tail -f /dev/null) — mantiene el container vivo y
#      permite `docker exec aibenchef-data aibenchef <cualquier-comando>`
#      como antes (cero breaking change en la interfaz externa).
#
# Si el daemon crashea, NO tumba el container (por eso NO uso `exec` ni lo
# hago PID 1). El cron `aibenchef-daily-sync` (3x/dia) sigue existiendo
# como safety net.
#
# Logs del daemon → /app/logs/worker-daemon-YYYY-MM-DD.log
set -uo pipefail

LOG_DIR="/app/logs"
mkdir -p "$LOG_DIR"

# Skip del daemon si DATABASE_URL no esta seteada — util para builds/tests
# que no tienen la DB (evita crash loops).
if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] DATABASE_URL vacio — worker_daemon NO arranca" >&2
else
    LOG_FILE="$LOG_DIR/worker-daemon-$(date -u +%Y-%m-%d).log"
    echo "[entrypoint] Arrancando worker_daemon en background (log: $LOG_FILE)"
    # `nohup` + `&` para desligarlo del shell del entrypoint.
    # `disown` para que no sea killed cuando entrypoint termine.
    nohup python -m aibenchef_data.worker_daemon >> "$LOG_FILE" 2>&1 &
    disown
    echo "[entrypoint] worker_daemon PID: $!"
fi

# Delega al CMD original (tail -f /dev/null por default). `exec` reemplaza
# el shell por el CMD → CMD queda como PID 1 (importante para señales).
exec "$@"
