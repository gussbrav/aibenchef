#!/bin/bash
# =============================================================================
# Daily SBS sync — descarga + import + quality-check
#
# Corre vía cron a las 11:00 UTC (06:00 Lima). El scraper SBS revisa si hay
# archivos nuevos publicados, los descarga, importa, valida. Todos los pasos
# son idempotentes (no duplican data si ya fue procesada).
#
# Logs:  /var/log/aibenchef/daily-sync-YYYY-MM-DD.log
# Owner: gussbrav@gmail.com
# =============================================================================
set -uo pipefail
exec 2>&1

LOG_DIR=/var/log/aibenchef
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-sync-$(date -u +%Y-%m-%d).log"

exec > >(tee -a "$LOG_FILE")
echo ""
echo "=============================================================================="
echo "aibenchef daily sync — started $(date -Iseconds)"
echo "=============================================================================="

# Container ID — Docker Swarm reasigna en cada deploy, lo buscamos cada vez
CID=$(docker ps --filter "name=aibenchef-data" --format "{{.ID}}" | head -1)
if [ -z "$CID" ]; then
    echo "ERROR: container aibenchef-data no esta corriendo"
    exit 1
fi

# Recheck stale no_publicados_sbs (V157) — invalida archivos locales
# corruptos (HTML basura guardado como .xls) y encola sync_jobs para
# re-descargar. Sin esto, los archivos que SBS publica TARDE quedan
# bloqueados eternamente por skip_if_exists (bug reportado 2026-08 con
# Indicadores CRAC/EDPYME del periodo 202606). Fail-safe: si la migracion
# V157 aun no corrio, el comando reporta error y seguimos con el resto.
echo ""
echo "[1/5] Recheck stale no_publicados (V157)..."
docker exec "$CID" aibenchef sbs recheck-stale-no-publicados 2>&1 | tee -a "$LOG_FILE" || true

# Encolar job sync para el mes anterior (idempotente: si ya existe, no-op).
# queue-monthly ahora tambien incluye stale_periodos (V157) — belt-and-
# suspenders con el paso [1/5].
echo ""
echo "[2/5] Queue monthly job..."
docker exec "$CID" aibenchef sbs queue-monthly 2>&1 | tee -a "$LOG_FILE" || true

# Procesar pendientes en admin.sync_jobs (scrape + import)
echo ""
echo "[3/5] Work pending jobs (scrape + import)..."
docker exec "$CID" aibenchef sbs work-jobs --max-jobs 10 2>&1 | tee -a "$LOG_FILE"

# Dump del contenido de los .xls nuevos a raw.archivo_contenido (visor Grid
# del Inspector de Tópicos). --skip-existing solo procesa archivos que aún no
# tienen contenido dumpeado, así no re-procesa los ~9700 ya hechos.
# Issue #65 — sin esto, los archivos nuevos no aparecen en el visor Grid hasta
# correr el script manualmente.
echo ""
echo "[4/5] Dump contenido archivos nuevos a raw.archivo_contenido..."
docker exec "$CID" /app/.venv/bin/python scripts/dump_archivo_contenido.py --skip-existing 2>&1 | tee -a "$LOG_FILE" || true

# Quality-check para los últimos 2 periodos (mes anterior y el anterior a ese)
# por si SBS hace correcciones tardías
PREV_MONTH=$(date -u -d "$(date -u +%Y-%m-15) -1 month" +%Y%m)
PREV_PREV_MONTH=$(date -u -d "$(date -u +%Y-%m-15) -2 month" +%Y%m)
echo ""
echo "[5/6] Quality-check periodos $PREV_PREV_MONTH y $PREV_MONTH..."
docker exec "$CID" aibenchef pipeline quality-check --periodo "$PREV_PREV_MONTH" --triggered-by "cron:daily" 2>&1 | tee -a "$LOG_FILE" || true
docker exec "$CID" aibenchef pipeline quality-check --periodo "$PREV_MONTH" --triggered-by "cron:daily" 2>&1 | tee -a "$LOG_FILE" || true

# Drift check: KPIs aibenchef vs SBS oficial (V158). Detecta cambios de
# formula o bugs de import que rompen la calibracion con las cifras
# publicadas por SBS. Solo para el mes anterior porque el actual puede
# tener SBS aun no publicado.
echo ""
echo "     Drift check SBS oficial (V158)..."
docker exec "$CID" aibenchef pipeline drift-check-sbs --periodo "$PREV_MONTH" --triggered-by "cron:daily" 2>&1 | tee -a "$LOG_FILE" || true

# Alerta critical: si hay archivos SBS overdue en severity=critical, log
# ERROR muy visible al final del cron. Sin esto los stale files se acumulan
# silenciosamente hasta que un usuario abre /dashboard/admin/data-quality.
#
# Si el ambiente tiene SLACK_WEBHOOK_URL configurado, tambien manda alerta
# a Slack (webhook simple, sin dependencias). Sin webhook, solo log.
#
# Query directa a la DB via psql — evita otra layer de indirección; el
# container aibenchef-data tiene DATABASE_URL en env.
echo ""
echo "[6/6] Alerta Data Quality critical..."
CRITICAL_JSON=$(docker exec "$CID" sh -c 'psql "$DATABASE_URL" -t -A -c "
    SELECT COALESCE(json_agg(row_to_json(v))::text, ''[]'')
    FROM (
        SELECT periodo, grupo, topico, n_faltantes, fecha_esperada,
               (CURRENT_DATE - fecha_esperada) AS dias_atraso
        FROM admin.v_missing_files
        WHERE severity = ''critical''
        ORDER BY dias_atraso DESC, periodo DESC
        LIMIT 20
    ) v
"' 2>/dev/null || echo "[]")

if [ "$CRITICAL_JSON" != "[]" ] && [ -n "$CRITICAL_JSON" ]; then
    N_CRITICAL=$(echo "$CRITICAL_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    printf "\n"
    printf "\033[0;31m╔══════════════════════════════════════════════════════════════════════╗\033[0m\n" | tee -a "$LOG_FILE"
    printf "\033[0;31m║  DATA QUALITY ALERT — %s archivos SBS overdue (severity=critical)  ║\033[0m\n" "$N_CRITICAL" | tee -a "$LOG_FILE"
    printf "\033[0;31m╚══════════════════════════════════════════════════════════════════════╝\033[0m\n" | tee -a "$LOG_FILE"
    echo "$CRITICAL_JSON" | python3 -m json.tool 2>/dev/null | tee -a "$LOG_FILE" || echo "$CRITICAL_JSON" | tee -a "$LOG_FILE"
    echo "Ver: https://aibenchef.azoramind.com/dashboard/admin/data-quality" | tee -a "$LOG_FILE"

    # Slack notification si el webhook esta configurado.
    # Formato simple: bloque de texto con los primeros N archivos + link al dashboard.
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        SLACK_TEXT=$(printf '⚠️ *Aibenchef Data Quality*: %s archivos SBS overdue (critical)\\n\\nVer: https://aibenchef.azoramind.com/dashboard/admin/data-quality' "$N_CRITICAL")
        curl -s -X POST -H 'Content-Type: application/json' \
            -d "{\"text\":\"$SLACK_TEXT\"}" \
            "$SLACK_WEBHOOK_URL" > /dev/null 2>&1 && \
            echo "  + Slack notification enviada" | tee -a "$LOG_FILE" || \
            echo "  ! Slack notification fallo" | tee -a "$LOG_FILE"
    fi
else
    echo "  OK — sin archivos overdue en severity=critical" | tee -a "$LOG_FILE"
fi

echo ""
echo "=============================================================================="
echo "aibenchef daily sync — finished $(date -Iseconds)"
echo "=============================================================================="
