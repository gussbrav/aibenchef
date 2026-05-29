#!/bin/bash
# =============================================================================
# Bulk re-ingest EEFF historico 200801-202412 (issue #42 fase C)
#
# Re-procesa todos los archivos EEFF .xls de los 5 grupos SBS para los anios
# 2008-2024 (los anios 2025+ ya tienen data correcta post-V099/V101).
#
# Estrategia: paralelismo POR GRUPO (5 workers concurrentes). Cada worker
# procesa sus anios secuencialmente. El importer es idempotente (ON CONFLICT
# en raw.eeff_observacion).
#
# Pre-condicion:
#   - V103 aplicada (cabecera_maestra sin filas-anotacion)
#   - Parser con _is_annotation_or_footnote_extra extendido (post-#47)
#   - Container con bind mount /app/local-data/raw apuntando a los archivos
#
# Uso (dentro del container aibenchef-data):
#   bash /tmp/bulk_reingest_historico.sh
#
# Output: /tmp/reingest_<grupo>.log por cada worker.
# =============================================================================
set -euo pipefail

GRUPOS=("banca_multiple" "cmac" "crac" "edpyme" "financiera")
ANIO_DESDE=2008
ANIO_HASTA=2024
RAW_ROOT="${RAW_STORAGE_DIR:-/app/local-data/raw}"
LOG_DIR=/tmp/reingest
mkdir -p "$LOG_DIR"

# Pre-flight checks
if ! command -v aibenchef >/dev/null 2>&1; then
    echo "ERROR: aibenchef CLI no encontrado. Esta corriendo dentro del container?" >&2
    exit 1
fi
if [ ! -d "$RAW_ROOT" ]; then
    echo "ERROR: $RAW_ROOT no existe. RAW_STORAGE_DIR mal seteado?" >&2
    exit 1
fi

echo "# Bulk re-ingest historico ${ANIO_DESDE}-${ANIO_HASTA}"
echo "# Raw root:  $RAW_ROOT"
echo "# Log dir:   $LOG_DIR"
echo "# Grupos:    ${GRUPOS[*]}"
echo "# Inicio:    $(date -Iseconds)"
echo ""

# Worker funcion: procesa un grupo en sus anios 2008-2024 secuencialmente
process_grupo() {
    local grupo=$1
    local log_file="$LOG_DIR/${grupo}.log"
    {
        echo "# Worker $grupo iniciado $(date -Iseconds)"
        local n_anios=0
        local n_skip=0
        for anio in $(seq $ANIO_DESDE $ANIO_HASTA); do
            local anio_path="$RAW_ROOT/$grupo/eeff/$anio"
            if [ ! -d "$anio_path" ]; then
                n_skip=$((n_skip+1))
                echo "  [skip] $anio_path no existe"
                continue
            fi
            n_anios=$((n_anios+1))
            echo ""
            echo "## $grupo / $anio"
            aibenchef import monthly-eeff "$anio_path" 2>&1 \
                | grep -E "^\s+\[|^# TOTAL|FATAL|! sheet=" \
                || true
        done
        echo ""
        echo "# Worker $grupo terminado $(date -Iseconds): $n_anios anios procesados, $n_skip omitidos"
    } > "$log_file" 2>&1
}

# Lanzar 5 workers en paralelo
for grupo in "${GRUPOS[@]}"; do
    process_grupo "$grupo" &
    echo "# Worker $grupo lanzado (PID $!)"
done

echo ""
echo "# Esperando workers... (tail -f $LOG_DIR/*.log para progreso)"
wait

echo ""
echo "# Bulk re-ingest TERMINADO $(date -Iseconds)"
echo ""
echo "## Resumen por grupo:"
for grupo in "${GRUPOS[@]}"; do
    log_file="$LOG_DIR/${grupo}.log"
    total_inserted=$(grep -hE "^# TOTAL:" "$log_file" \
        | sed -nE 's/.*TOTAL: ([0-9,]+) filas.*/\1/p' \
        | tr -d ',' \
        | awk '{s+=$1} END {print s}')
    total_errors=$(grep -hE "^# TOTAL:" "$log_file" \
        | sed -nE 's/.*, ([0-9]+) errores.*/\1/p' \
        | awk '{s+=$1} END {print s}')
    total_archivos=$(grep -cE "^\s+\[" "$log_file" || true)
    printf "  %-15s archivos=%4d  filas_total=%10s  errores=%s\n" \
        "$grupo" "$total_archivos" "${total_inserted:-0}" "${total_errors:-0}"
done
