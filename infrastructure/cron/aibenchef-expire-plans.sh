#!/bin/bash
# =============================================================================
# aibenchef expire-plans — cron DIARIO
#
# Downgrade automatico de:
#   1) Trials vencidos    -> plan=free   (auth.expire_trials    — V173/V179)
#   2) Planes pagados vencidos (academic/pro/business) -> plan=free
#      con marker plan_notes="[plan_expired ...]" (auth.expire_paid_plans — V176)
#
# Idempotente: si nada esta vencido, sale sin cambios. Batch 500 por
# funcion. Fail-safe: cualquier error deja los planes intactos.
#
# Logs: /var/log/aibenchef/expire-plans-YYYY-MM-DD.log
# =============================================================================
set -uo pipefail
exec 2>&1

LOG_DIR=/var/log/aibenchef
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/expire-plans-$(date -u +%Y-%m-%d).log"

# Ejecutamos SQL directo contra el container postgres (mismo patron que
# aibenchef-work-jobs.sh). Evita depender de tsx en el container web.
PG_CID=$(docker ps --filter "name=azoramind_postgres" --format "{{.ID}}" | head -1)
if [ -z "$PG_CID" ]; then
    echo "[$(date -Iseconds)] ERROR: postgres container no esta corriendo" >> "$LOG_FILE"
    exit 1
fi

echo "" >> "$LOG_FILE"
echo "[$(date -Iseconds)] expire-plans start" >> "$LOG_FILE"

# Trials vencidos
docker exec "$PG_CID" psql -U postgres -d aibenchef -t -A -c \
    "SELECT 'trials_expired=' || expired_count FROM auth.expire_trials()" \
    2>&1 | tee -a "$LOG_FILE"

# Planes pagados vencidos
docker exec "$PG_CID" psql -U postgres -d aibenchef -t -A -c \
    "SELECT 'paid_expired=' || expired_count || ' by_plan=' || by_plan::text FROM auth.expire_paid_plans()" \
    2>&1 | tee -a "$LOG_FILE"

echo "[$(date -Iseconds)] expire-plans done" >> "$LOG_FILE"
