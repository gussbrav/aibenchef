# =========================================================================
# Dockerfile data-platform (issue #42)
#
# Aibenchef data worker: scraper SBS (playwright) + importers + CLI
# (`aibenchef ...`) + quality-check + dbt orchestration.
#
# Build context: ./data-platform/ (no root del monorepo).
# Runtime: container long-running con CMD pasivo (tail -f /dev/null).
# Los jobs se ejecutan con `docker exec aibenchef-data uv run aibenchef <cmd>`
# o via cron registrado en EasyPanel.
#
# Volumen bind: /app/local-data/raw <- /etc/easypanel/projects/azoramind/
#                                       aibenchef-data/raw (en host)
# =========================================================================

# -------------------------------------------------------------------------
# Stage 1: builder — instala uv + sync de dependencias en .venv
# -------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    # Timeout de descarga de wheels. Default uv es 30s, insuficiente en
    # redes lentas (EasyPanel timeoutea con sqlalchemy 2.0.49 en 30s).
    # Subimos a 180s + habilitamos 3 retries automaticos.
    UV_HTTP_TIMEOUT=180 \
    UV_CONCURRENT_DOWNLOADS=4

# uv como binario standalone (mas reproducible que pip install uv)
COPY --from=ghcr.io/astral-sh/uv:0.5.18 /uv /usr/local/bin/uv

# Deps del sistema necesarias para compilar wheels (lxml, psycopg, etc) y
# para playwright (browsers se instalan luego).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libxml2-dev \
        libxslt1-dev \
        libpq-dev \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cachear capas de dependencias: sync primero solo con pyproject + lock
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Copiar el codigo y hacer install del proyecto (para que `aibenchef` CLI
# quede disponible en .venv/bin)
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# -------------------------------------------------------------------------
# Stage 2: runtime — imagen slim con .venv + browsers de playwright
# -------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

# Deps runtime: libs para playwright/chromium + utilidades operativas
# (tini para PID 1, postgresql-client para psql adhoc, curl para healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini \
        curl \
        postgresql-client \
        libxml2 \
        libxslt1.1 \
        libpq5 \
        ca-certificates \
        # Deps chromium (sacadas de `playwright install-deps chromium` para
        # debian bookworm):
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar venv del builder
COPY --from=builder /app/.venv /app/.venv

# Instalar browser chromium (solo el que usa el scraper SBS)
RUN python -m playwright install chromium --with-deps 2>/dev/null \
    || python -m playwright install chromium  # fallback si --with-deps fails

# Copiar resto del codigo (src ya esta en venv pero scripts/tests/etc lo
# queremos para invocar audit/quality_check_all_periodos/etc)
COPY src ./src
COPY scripts ./scripts
COPY seeds ./seeds

# Crear paths para volumen y logs (los volumenes los popula EasyPanel via
# bind mount al startup del container)
RUN mkdir -p /app/local-data/raw /app/out /app/logs

# Usuario no-root (mismo UID convencional EasyPanel: 1001)
RUN groupadd --system --gid 1001 aibenchef \
    && useradd --system --uid 1001 --gid aibenchef --create-home aibenchef \
    && chown -R aibenchef:aibenchef /app /opt/playwright

USER aibenchef

# Healthcheck: el container esta sano si `aibenchef --help` corre
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
    CMD aibenchef --help > /dev/null 2>&1 || exit 1

# Tini como PID 1 para que SIGTERM se propague a procesos hijos
ENTRYPOINT ["/usr/bin/tini", "--"]

# CMD pasivo: container queda vivo, los jobs se invocan con docker exec o cron
CMD ["tail", "-f", "/dev/null"]
