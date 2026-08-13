#!/bin/sh
# =========================================================================
# warmup.sh — pre-compila las rutas SSR criticas del dashboard tras el boot.
#
# Problema que resuelve:
#   Next.js 15 en modo `next start` sirve rutas ya construidas, pero la
#   PRIMERA request a cada ruta paga un costo de bootstrap (~5-15s):
#   - Carga lazy chunks JS
#   - Warmup del pool de conexiones DB
#   - Cache miss de unstable_cache (getInformeData vale 5s+ en cache miss)
#
#   Sin warmup, el primer usuario que abre /dashboard/informe post-deploy
#   ve 'Cargando...' por 15+ segundos y siente que la app esta rota.
#
# Estrategia:
#   1. Esperar a que /api/health responda (server ready)
#   2. Hit paralelo a las rutas criticas con --max-redirect=0 para NO
#      seguir el redirect a /login (solo importa compilar la ruta).
#   3. Todo async: no bloquea el arranque del contenedor.
#
# Se ejecuta en background desde el CMD del Dockerfile.
# =========================================================================
set -eu

echo "[WARMUP] esperando /api/health..."
for i in $(seq 1 90); do
    if wget -q -O /dev/null http://localhost:3000/api/health 2>/dev/null; then
        echo "[WARMUP] server ready tras ${i}s"
        break
    fi
    sleep 1
done

# Rutas a pre-compilar. --max-redirect=0 hace que el warmup redirija a
# /login (307) sin seguirlo — el objetivo es COMPILAR la ruta, no cargar
# el usuario logueado. La compilacion queda cacheada para el primer
# usuario real.
ROUTES="\
/dashboard \
/dashboard/informe \
/dashboard/dupont \
/dashboard/punto-equilibrio \
/dashboard/publicaciones \
/dashboard/eeff \
/dashboard/analisis \
/dashboard/tableros \
/dashboard/settings \
/login \
/signup \
/docs/api \
/docs/mcp \
/"

for route in $ROUTES; do
    START=$(date +%s)
    STATUS=$(wget -q -S --max-redirect=0 --timeout=45 -O /dev/null \
        "http://localhost:3000${route}" 2>&1 | grep "HTTP/" | head -1 | awk '{print $2}')
    ELAPSED=$(($(date +%s) - START))
    echo "[WARMUP] ${route} -> ${STATUS:-timeout} (${ELAPSED}s)"
done

echo "[WARMUP] done."
