#!/bin/bash
# =============================================================================
# aibenchef work-jobs — cron de ALTA FRECUENCIA (cada 5 min)
#
# Proposito: reducir la latencia entre "usuario encola sync_job desde
# /dashboard/admin/data-quality" y "worker lo procesa" de 3-8 horas
# (cron daily-sync) a 5 minutos maximo.
#
# Este script es DELIBERADAMENTE LIGERO — solo hace `sbs work-jobs`
# (procesa la cola de admin.sync_jobs). NO hace queue-monthly, dump,
# quality-check, drift-check. Esos siguen viviendo en aibenchef-daily-sync.sh
# que corre 3x/dia.
#
# Idempotente y seguro: si no hay sync_jobs pending, sale sin hacer nada.
# Si hay uno en running, tampoco lo duplica (la CLI ya lockea).
#
# Logs: /var/log/aibenchef/work-jobs-YYYY-MM-DD.log (rotacion diaria)
# =============================================================================
set -uo pipefail
exec 2>&1

LOG_DIR=/var/log/aibenchef
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/work-jobs-$(date -u +%Y-%m-%d).log"

# Container ID — Docker Swarm reasigna en cada deploy
CID=$(docker ps --filter "name=aibenchef-data" --format "{{.ID}}" | head -1)
if [ -z "$CID" ]; then
    echo "[$(date -Iseconds)] ERROR: container aibenchef-data no esta corriendo" >> "$LOG_FILE"
    exit 1
fi

# Check RAPIDO: hay jobs pending? Si no, exit silencioso (evita ruido en log)
N_PENDING=$(docker exec "$CID" sh -c 'psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM admin.sync_jobs WHERE status = '"'"'pending'"'"'"' 2>/dev/null | tr -d ' \n' || echo "0")

if [ "$N_PENDING" = "0" ]; then
    # Sin ruido — solo escribimos 1 linea cada X ejecuciones para no
    # inundar el log con "sin jobs pending" cada 5 min.
    # (Log solo si el minuto es 0 o 30 — 2 marcas por hora)
    MIN=$(date -u +%M)
    if [ "$MIN" = "00" ] || [ "$MIN" = "30" ]; then
        echo "[$(date -Iseconds)] pending=0, skip" >> "$LOG_FILE"
    fi
    exit 0
fi

echo "" >> "$LOG_FILE"
echo "[$(date -Iseconds)] Procesando $N_PENDING sync_jobs pending..." >> "$LOG_FILE"
docker exec "$CID" aibenchef sbs work-jobs --max-jobs 10 2>&1 | tee -a "$LOG_FILE"
echo "[$(date -Iseconds)] Fin work-jobs" >> "$LOG_FILE"
