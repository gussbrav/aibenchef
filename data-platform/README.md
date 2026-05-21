# data-platform

Servicio Python para ingesta y procesamiento de datos publicos SBS.

## Estructura (DDD)

```
data-platform/
├── pyproject.toml
├── seeds/
│   └── entidades.json              <- catalogo seed (codigo_sbs, nombre, grupo)
├── src/aibenchef_data/
│   ├── __init__.py
│   ├── env.py                      <- pydantic-settings
│   ├── cli.py                      <- entrypoint (aibenchef ...)
│   ├── domains/
│   │   ├── shared/                 <- logger, errors, Result
│   │   ├── catalog/                <- entidades, topicos, periodos (Fase 1.2 ✓)
│   │   ├── scraping/               <- descarga SBS (Fase 1.3)
│   │   ├── parsing/                <- .xls -> pydantic (Fase 1.4)
│   │   └── loading/                <- raw.* postgres (Fase 1.5)
│   └── infrastructure/
│       ├── db.py                   <- psycopg async pool
│       └── storage.py              <- local fs (despues MinIO)
├── dbt/                            <- dbt project (Fase 1.6)
├── tests/
└── .env.example
```

## Setup local

```bash
cd data-platform
uv sync
cp .env.example .env  # editar DATABASE_URL si hace falta
uv run aibenchef --help
```

## Comandos disponibles (Fase 1.1 + 1.2)

```bash
# Inspeccionar el catalogo
uv run aibenchef catalog list-entidades
uv run aibenchef catalog list-entidades --grupo cmac
uv run aibenchef catalog list-entidades --solo-microfinanzas
uv run aibenchef catalog show-topicos
uv run aibenchef catalog periodo 202404
uv run aibenchef catalog periodo           # mes anterior

# Pipeline (stub aun — completar Fase 1.3-1.5)
uv run aibenchef ingest --periodo 202404
uv run aibenchef ingest --periodo 202404 --grupo cmac --topico eeff --dry-run
```

## Tests

```bash
uv run pytest
uv run ruff check .
uv run mypy src/
```
