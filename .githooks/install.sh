#!/usr/bin/env sh
# Activa los hooks de este repo (.githooks/) como hooksPath para git.
# Idempotente — se puede correr multiples veces.

set -e
cd "$(dirname "$0")/.."

git config core.hooksPath .githooks
chmod +x .githooks/pre-push 2>/dev/null || true

echo "[hooks] Activados:"
echo "  - pre-push (ruff check + format + smoke tests)"
echo ""
echo "Bypass de emergencia: git push --no-verify"
