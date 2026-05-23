# Auditoría — Flujos de Ingesta

**Estado general: 🔴 ROJO**

## Veredicto en 3 líneas

1. El workflow `monthly-sbs-ingestion.yml` está **roto en producción**: invoca `python -m scrapers.sbs.cli` pero el módulo se llama `aibenchef_data.cli` (entrypoint `aibenchef`). El cron del día 5 viene fallando silenciosamente desde que se renombró el paquete.
2. **Cero tests** del flujo de scraping (`HttpxDownloader`, `DiscoverTargets`, `storage scan`). Solo hay test del URL builder. Toda la capa de red/IO está sin red de seguridad.
3. `scrape` y `storage scan` son **dos pipelines desacoplados**: `scrape` baja archivos pero NO inserta en `raw.archivos_descargados`. Hay que correr `aibenchef storage scan` manualmente después. El comentario de `V013__raw_archivos_descargados.sql:7` dice "El scraper inserta después de cada download exitoso" — eso NO ocurre.

---

## Flujo 1 — Scrape SBS

- **Qué hace:** descarga .xls de `https://intranet2.sbs.gob.pe/estadistica/financiera/...` al filesystem local.
- **Entrada:** `Periodo` (YYYYMM), `grupos[]`, `topicos[]`. Base URL en `env.py:40`.
- **Salida:** archivos en `./local-data/raw/<grupo>/<topico>/<anio>/<mes>/<filename>.xls`. **Sin escritura a Postgres.**
- **Código clave:**
  - `data-platform/src/aibenchef_data/cli.py:1173-1222` — comando `scrape`
  - `data-platform/src/aibenchef_data/cli.py:1239-1275` — `_run_scrape`
  - `domains/scraping/services/discover_targets.py:18-43` — planner
  - `domains/scraping/services/http_downloader.py:48-150` — download + retry
  - `domains/scraping/services/downloader_service.py:26-46` — concurrencia
  - `infrastructure/http.py:13-42` — cliente httpx
- **¿Funciona hoy?** **Parcial.** Local: sí, manualmente con `aibenchef scrape --periodo YYYYMM`. CI: NO.
- **HTTP client**: timeouts (connect=10s, read=60s), `follow_redirects=True`, HTTP/1.1, User-Agent custom. Retries con `tenacity` (3 intentos, backoff exponencial).
- **Bugs:**
  - `http_downloader.py:154` — `from pathlib import Path` está al final del archivo. Funciona por suerte.
  - `cli.py:1294` — `ingest` invoca `scrape` pero no propaga `--desde/--hasta`, solo `periodo`.
  - `_MIN_VALID_SIZE_BYTES = 2_000` (`http_downloader.py:25`) detecta HTML-error camuflado pero no avisa en stdout salvo via `log.warning`.
- **Tests:** ninguno. Solo `tests/unit/test_sbs_url.py`.
- **Health check:** `aibenchef scrape --periodo 202604 --grupo cmac --topico eeff --dry-run`.
- **Riesgos:** sin observabilidad, sin escritura a `raw.archivos_descargados`, fallos 404 se confunden con error transitorio.

---

## Flujo 2 — Storage scan

- **Qué hace:** escanea `./local-data/raw/` recursivamente, hashea MD5, detecta formato, UPSERT a `raw.archivos_descargados`.
- **Entrada:** dir `--root` (default `./local-data/raw`), `--dry-run`.
- **Salida:** filas en `raw.archivos_descargados` (`V013` migration). Status FSM: `descargado→procesando→procesado|error|omitido`.
- **Código clave:** `cli.py:84-204` (`storage_scan`).
- **¿Funciona hoy?** Sí, localmente. Idempotente vía `ON CONFLICT (path_local) DO UPDATE`. Usa psycopg sync.
- **Bugs / deuda:**
  - **Desacople del scrape**: debería ser invocado por `DownloaderService` post-descarga.
  - Reconstrucción de `source_url` por string-concat (`cli.py:159`). Si SBS cambia el path, drift.
  - MD5 lee archivo completo en memoria (debería ser streaming).
  - `formato` con `except Exception: fmt = None` — silencia bugs.
- **Tests:** ninguno.
- **Health check:** `SELECT count(*), status FROM raw.archivos_descargados GROUP BY status`.

---

## Flujo 3 — GH Action `monthly-sbs-ingestion.yml`

- **Qué hace (intenta):** cron día 5 06:00 UTC → checkout → uv + Python 3.12 + playwright → `python -m scrapers.sbs.cli ingest` → `dbt run` + `dbt test` → Slack on failure.
- **Código clave:** `.github/workflows/monthly-sbs-ingestion.yml:1-45`.
- **¿Funciona hoy?** **NO.** Bugs serios:
  - **Línea 36**: `python -m scrapers.sbs.cli` **no existe**. El paquete real es `aibenchef_data` y entrypoint `aibenchef`. Debe ser: `uv run aibenchef ingest --periodo "${PERIODO:-}"`.
  - **Líneas 37-38**: `uv run dbt run --profiles-dir .` ejecutado desde `data-platform/`, pero `dbt_project.yml` vive en `data-platform/dbt/`. dbt fallará. Debe ser `--project-dir dbt --profiles-dir dbt`.
  - No invoca `aibenchef storage scan`, así que `raw.archivos_descargados` nunca se actualiza desde CI.
  - `ingest` (`cli.py:1287`) es un stub: solo corre `scrape`, no parse ni load. No popula `raw.eeff_observacion`.
  - Secrets R2_* declarados pero ningún código en `aibenchef_data` los lee (`infrastructure/storage.py:15-35` es local-only).
  - Día 5 puede ser muy temprano para datos del mes anterior (SBS publica entre día 30-45).

---

## Resumen accionable

| # | Severidad | Fix |
|---|---|---|
| 1 | Crítica | `monthly-sbs-ingestion.yml:36` → `uv run aibenchef ingest --periodo "${PERIODO:-}"` |
| 2 | Crítica | `monthly-sbs-ingestion.yml:37-38` → `--project-dir dbt --profiles-dir dbt` |
| 3 | Alta | Agregar `uv run aibenchef storage scan` entre scrape y dbt |
| 4 | Alta | Hacer que `HttpxDownloader` registre en `raw.archivos_descargados` directamente |
| 5 | Media | Tests para `HttpxDownloader` (mock httpx) + `storage scan` (tmpdir + psycopg) |
| 6 | Media | Completar `ingest` para que parse+load reales (hoy es stub) |
| 7 | Baja | Mover `from pathlib import Path` al top de `http_downloader.py` |
