"""Pytest fixtures globales para Aibenchef data-platform.

Provee:
- `pg_container`: Postgres efimero via testcontainers para tests @pytest.mark.integration
- `pg_dsn`: DSN string del container listo para psycopg
- Helpers de path para fixtures de archivos .xls

Tests puros (parsing, normalizacion, layouts) no usan estos fixtures.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

# psycopg async no soporta ProactorEventLoop en Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    """Directorio con archivos .xls de muestra para tests de parsing."""
    return FIXTURES_DIR


@pytest.fixture(scope="session")
def pg_container() -> Iterator[object]:
    """Levanta un Postgres efimero en Docker (testcontainers).

    Solo se usa en tests marcados con @pytest.mark.integration.
    Si Docker no esta disponible, los tests se omiten con SKIP.
    """
    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:
        pytest.skip("testcontainers no instalado")

    try:
        container = PostgresContainer(
            image="postgres:17-alpine",
            username="aibenchef",
            password="aibenchef",
            dbname="aibenchef_test",
        )
        container.start()
    except Exception as e:
        pytest.skip(f"Docker no disponible: {e}")
    try:
        yield container
    finally:
        container.stop()


@pytest.fixture(scope="session")
def pg_dsn(pg_container) -> str:
    """DSN psycopg listo (sin el prefijo SQLAlchemy)."""
    url = pg_container.get_connection_url()
    # testcontainers devuelve postgresql+psycopg2://; lo normalizamos
    return url.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgresql+psycopg://", "postgresql://"
    )
