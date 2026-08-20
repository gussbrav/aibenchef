#!/bin/bash
# =============================================================================
# aibenchef reconcile-ratios — cron DIARIO
#
# QA de metodologia: compara nuestros ratios calculados (ROA, ROE, Mora)
# contra los valores oficiales publicados por SBS en el Excel prudencial.
# Popula gov.ratio_reconciliation.
#
# Al usuario final SIEMPRE se le muestra nuestro calculo — esto es
# back-office puro para detectar drift/bugs de metodologia. Si aparecen
# divergencias > 5 bps, el sidebar admin muestra badge rojo y admin
# investiga en /dashboard/admin/reconciliacion-sbs.
#
# Idempotente: si SBS aun no publica el mes en curso, sale sin cambios.
#
# Logs: /var/log/aibenchef/reconcile-ratios-YYYY-MM-DD.log
# =============================================================================
set -uo pipefail
exec 2>&1

LOG_DIR=/var/log/aibenchef
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/reconcile-ratios-$(date -u +%Y-%m-%d).log"

PG_CID=$(docker ps --filter "name=azoramind_postgres" --format "{{.ID}}" | head -1)
if [ -z "$PG_CID" ]; then
    echo "[$(date -Iseconds)] ERROR: postgres container no esta corriendo" >> "$LOG_FILE"
    exit 1
fi

echo "" >> "$LOG_FILE"
echo "[$(date -Iseconds)] reconcile-ratios start" >> "$LOG_FILE"

# La funcion sin argumento usa el ultimo periodo con data SBS publicada.
docker exec "$PG_CID" psql -U postgres -d aibenchef -t -A -c \
    "SELECT 'periodo=' || COALESCE(periodo_out::text, 'null')
         || ' reconciled=' || reconciled_count
         || ' divergences=' || divergence_count
         || ' by_indicador=' || by_indicador::text
       FROM gov.reconcile_ratios(NULL)" \
    2>&1 | tee -a "$LOG_FILE"

echo "[$(date -Iseconds)] reconcile-ratios done" >> "$LOG_FILE"
