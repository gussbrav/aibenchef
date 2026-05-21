#!/bin/sh
# Entry point del container aibenchef-web.
# Corre las migraciones de DB antes de levantar Next.js.

set -e

echo "[start] running migrations..."
node /app/scripts/migrate.js

echo "[start] launching Next.js server on port ${PORT:-3000}..."
exec node /app/apps/web/server.js
