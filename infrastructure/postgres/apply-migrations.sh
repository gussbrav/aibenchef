#!/usr/bin/env bash
# Aplica migraciones SQL en orden V<N>__*.sql contra DATABASE_URL.
# Idempotente: cada V<N> debe ser idempotente por convencion.

set -euo pipefail

DB="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/aibenchef}"
MIGRATIONS_DIR="$(dirname "$0")/migrations"

echo "Apply migrations against $DB"

# Garantiza tabla de versiones
psql "$DB" -v ON_ERROR_STOP=1 <<'EOF'
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
EOF

for f in $(ls -1 "$MIGRATIONS_DIR"/V*.sql | sort); do
    name=$(basename "$f")
    version="${name%%__*}"
    applied=$(psql "$DB" -tAc "SELECT 1 FROM public.schema_migrations WHERE version='$version'")
    if [ "$applied" = "1" ]; then
        echo "[skip] $name (already applied)"
        continue
    fi
    echo "[apply] $name"
    psql "$DB" -v ON_ERROR_STOP=1 -f "$f"
    psql "$DB" -c "INSERT INTO public.schema_migrations(version) VALUES ('$version')"
done

echo "Done."
