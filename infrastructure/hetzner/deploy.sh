#!/usr/bin/env bash
# =========================================================================
# Deploy Aibenchef al VPS Hetzner.
# Ejecutar EN EL VPS via SSH, no localmente.
# =========================================================================

set -euo pipefail

cd "$(dirname "$0")/../.."

echo "==> Pull ultima version desde GitHub"
git pull --rebase --autostash origin main

echo "==> Cargar variables de entorno"
if [ ! -f infrastructure/hetzner/.env.production ]; then
    echo "ERROR: falta infrastructure/hetzner/.env.production"
    echo "Copia .env.production.example y rellena los secrets."
    exit 1
fi
set -a
source infrastructure/hetzner/.env.production
set +a

echo "==> Build images"
docker compose -f infrastructure/hetzner/docker-compose.production.yml build --pull

echo "==> Aplicar migraciones SQL"
docker compose -f infrastructure/hetzner/docker-compose.production.yml up -d postgres
sleep 5
docker compose -f infrastructure/hetzner/docker-compose.production.yml exec -T postgres \
    pg_isready -U "${POSTGRES_USER:-aibenchef}" -d aibenchef -t 30 || {
    echo "ERROR: postgres no responde"
    exit 1
}
for f in infrastructure/postgres/migrations/V*.sql; do
    echo "  applying $(basename "$f")"
    docker compose -f infrastructure/hetzner/docker-compose.production.yml exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
        psql -U "${POSTGRES_USER:-aibenchef}" -d aibenchef -v ON_ERROR_STOP=1 < "$f"
done

echo "==> Levantar todo el stack"
docker compose -f infrastructure/hetzner/docker-compose.production.yml up -d --remove-orphans

echo "==> Esperar healthchecks"
sleep 10
docker compose -f infrastructure/hetzner/docker-compose.production.yml ps

echo "==> Limpiar imagenes huerfanas"
docker image prune -f

echo "==> Deploy listo en https://aibenchef.azoramind.com"
