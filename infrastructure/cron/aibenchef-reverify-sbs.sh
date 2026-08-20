#!/bin/bash
# =============================================================================
# aibenchef reverify-sbs — cron cada 6h
#
# Encola sync_jobs con force_redownload=true para archivos SBS marcados
# 'no_publicado_sbs' que:
#   - Ya pasaron su publish_lag + 3 dias (fecha esperada SBS)
#   - No fueron re-checkeados en las ultimas 72h (rate limit)
#
# Alimentado por admin.v_no_publicados_reverificables (V178).
#
# Cierra la brecha entre "SBS publico" y "nuestro sistema se entera",
# especialmente util cuando la ingesta manual no corre a tiempo.
#
# Idempotente: si un periodo ya tiene sync_job pending/running, skip.
# Batch cap 20 jobs por corrida.
#
# Logs: /var/log/aibenchef/reverify-sbs-YYYY-MM-DD.log
# =============================================================================
set -uo pipefail
exec 2>&1

LOG_DIR=/var/log/aibenchef
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/reverify-sbs-$(date -u +%Y-%m-%d).log"
MAX_JOBS=20

PG_CID=$(docker ps --filter "name=azoramind_postgres" --format "{{.ID}}" | head -1)
if [ -z "$PG_CID" ]; then
    echo "[$(date -Iseconds)] ERROR: postgres container no esta corriendo" >> "$LOG_FILE"
    exit 1
fi

# Contar re-verificables. Si es 0, skip silencioso.
N_REVERIFY=$(docker exec "$PG_CID" psql -U postgres -d aibenchef -t -A -c \
    "SELECT COUNT(DISTINCT periodo) FROM admin.v_no_publicados_reverificables" \
    2>/dev/null | tr -d ' \n' || echo "0")

if [ "$N_REVERIFY" = "0" ]; then
    # Log solo 1x/dia (a las 00:00 UTC) para no ensuciar
    HOUR=$(date -u +%H)
    if [ "$HOUR" = "00" ]; then
        echo "[$(date -Iseconds)] no hay archivos re-verificables — skip" >> "$LOG_FILE"
    fi
    exit 0
fi

echo "" >> "$LOG_FILE"
echo "[$(date -Iseconds)] reverify-sbs: $N_REVERIFY periodos con archivos re-verificables (cap ${MAX_JOBS})" >> "$LOG_FILE"

# Encolar sync_jobs para los N periodos mas antiguos, respetando idempotencia
# (no duplicar si ya hay pending/running).
docker exec "$PG_CID" psql -U postgres -d aibenchef -c \
    "WITH periodos AS (
       SELECT DISTINCT periodo
         FROM admin.v_no_publicados_reverificables
        ORDER BY periodo DESC
        LIMIT ${MAX_JOBS}
     )
     INSERT INTO admin.sync_jobs (periodo_desde, periodo_hasta, force_redownload, triggered_by, triggered_by_email)
     SELECT p.periodo, p.periodo, true, 'reverify-sbs-cron', 'system@aibenchef.internal'
       FROM periodos p
      WHERE NOT EXISTS (
        SELECT 1 FROM admin.sync_jobs sj
         WHERE sj.status IN ('pending', 'running')
           AND sj.periodo_desde = p.periodo
           AND sj.periodo_hasta = p.periodo
      )
     RETURNING id, periodo_desde;" \
    2>&1 | tee -a "$LOG_FILE"

echo "[$(date -Iseconds)] reverify-sbs done" >> "$LOG_FILE"
