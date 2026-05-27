"""Integration tests para carga_log + mark_archivo_* contra Postgres real.

Issue #18 — verifica que los hooks de observabilidad escriben en DB
correctamente, manejan errores, y son compatibles con migrations
del schema (V007 base + V093 extension).
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
import pytest
import pytest_asyncio

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def setup_pipeline_schema(pg_dsn: str) -> AsyncIterator[str]:
    """Aplica las migrations relevantes para pipeline observability.

    Crea las tablas minimas usadas por carga_log + mark_archivo_*:
    - raw.archivos_descargados (V013 + V089)
    - raw.carga_log (V007 + V093)
    - admin.sync_jobs (V075) — referenciada por carga_log FK

    No corre todas las migrations (V001..V094), solo lo necesario para
    aislar el test de regresiones en otras areas.
    """
    sync_dsn = pg_dsn.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(sync_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS raw;")
            cur.execute("CREATE SCHEMA IF NOT EXISTS admin;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS raw.archivos_descargados (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    grupo TEXT NOT NULL,
                    topico TEXT NOT NULL,
                    periodo INT NOT NULL,
                    anio INT NOT NULL,
                    mes INT NOT NULL,
                    nombre_archivo TEXT NOT NULL,
                    path_local TEXT NOT NULL UNIQUE,
                    source_url TEXT NOT NULL,
                    tamanio_bytes BIGINT NOT NULL,
                    md5_hash TEXT,
                    formato TEXT,
                    status TEXT NOT NULL DEFAULT 'descargado'
                        CHECK (status IN ('descargado','procesando','procesado','error','omitido','no_publicado_sbs')),
                    filas_insertadas INT,
                    error_mensaje TEXT,
                    procesado_en TIMESTAMPTZ,
                    descargado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
                    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admin.sync_jobs (
                    id BIGSERIAL PRIMARY KEY,
                    periodo_desde INT NOT NULL,
                    periodo_hasta INT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending'
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS raw.carga_log (
                    id BIGSERIAL PRIMARY KEY,
                    source TEXT NOT NULL,
                    source_file TEXT,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    finished_at TIMESTAMPTZ,
                    status TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'success', 'failed')),
                    rows_inserted INT NOT NULL DEFAULT 0,
                    rows_updated INT NOT NULL DEFAULT 0,
                    rows_skipped INT NOT NULL DEFAULT 0,
                    error_message TEXT,
                    metadata JSONB,
                    stage TEXT,
                    topico TEXT,
                    periodo INT,
                    archivo_id UUID REFERENCES raw.archivos_descargados(id) ON DELETE SET NULL,
                    triggered_by TEXT,
                    sync_job_id BIGINT REFERENCES admin.sync_jobs(id) ON DELETE SET NULL
                );
            """)
        conn.commit()
    yield pg_dsn


def _connection_factory(dsn: str):
    """Helper que retorna un context manager async para una conexion."""

    @asynccontextmanager
    async def _factory():
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            yield conn

    return _factory


async def test_carga_log_context_happy_path(setup_pipeline_schema: str):
    """Verifica que carga_log_context crea fila 'running' y la cierra como 'success'."""
    from aibenchef_data.domains.shared import carga_log_context

    dsn = setup_pipeline_schema
    factory = _connection_factory(dsn)

    async with carga_log_context(
        factory,
        stage="import",
        topico="eeff",
        periodo=202604,
        triggered_by="cli:test",
    ) as log:
        assert log.log_id > 0
        log.rows_inserted = 1234
        log.metadata["layout"] = "BANCOS"

    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT status, rows_inserted, stage, topico, periodo, metadata, finished_at IS NOT NULL
                   FROM raw.carga_log WHERE id = %s""",
            (log.log_id,),
        )
        row = cur.fetchone()
        assert row is not None
        assert row[0] == "success"
        assert row[1] == 1234
        assert row[2] == "import"
        assert row[3] == "eeff"
        assert row[4] == 202604
        assert row[5]["layout"] == "BANCOS"
        assert row[6] is True


async def test_carga_log_context_failure_path(setup_pipeline_schema: str):
    """Verifica que una excepcion dentro del context marca el row como 'failed'."""
    from aibenchef_data.domains.shared import carga_log_context

    dsn = setup_pipeline_schema
    factory = _connection_factory(dsn)

    log_id_capturado = None

    with pytest.raises(RuntimeError, match="explosion"):
        async with carga_log_context(
            factory,
            stage="import",
            topico="eeff",
            periodo=202604,
        ) as log:
            log_id_capturado = log.log_id
            log.rows_inserted = 500  # algo se inserto antes del fallo
            raise RuntimeError("explosion controlada")

    assert log_id_capturado is not None
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT status, rows_inserted, error_message
                   FROM raw.carga_log WHERE id = %s""",
            (log_id_capturado,),
        )
        row = cur.fetchone()
        assert row[0] == "failed"
        # Aun los contadores parciales deben quedar registrados.
        assert row[1] == 500
        assert "explosion controlada" in row[2]


async def test_mark_archivo_procesado_cambia_status_a_procesado(setup_pipeline_schema: str):
    """G1 — verifica que mark_archivo_procesado actualiza el row correctamente."""
    from aibenchef_data.domains.shared import mark_archivo_procesado

    dsn = setup_pipeline_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    # Setup: insertar un archivo en estado 'descargado'
    with psycopg.connect(sync_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO raw.archivos_descargados (
                       grupo, topico, periodo, anio, mes, nombre_archivo,
                       path_local, source_url, tamanio_bytes
                   ) VALUES ('banca_multiple', 'eeff', 202604, 2026, 4,
                             'B-test.xls', '/tmp/B-test.xls', 'https://x', 1000)
                   RETURNING id""",
            )
            archivo_id = cur.fetchone()[0]
        conn.commit()

    # Act: marcar como procesado via helper
    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        await mark_archivo_procesado(conn, archivo_id=archivo_id, filas_insertadas=5678)
        await conn.commit()

    # Assert
    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT status, filas_insertadas, procesado_en IS NOT NULL, error_mensaje
                   FROM raw.archivos_descargados WHERE id = %s""",
            (archivo_id,),
        )
        row = cur.fetchone()
        assert row[0] == "procesado"
        assert row[1] == 5678
        assert row[2] is True
        assert row[3] is None


async def test_mark_archivo_error_setea_error_mensaje_y_status(setup_pipeline_schema: str):
    """G1 — verifica que mark_archivo_error marca el row con detalle del fallo."""
    from aibenchef_data.domains.shared import mark_archivo_error

    dsn = setup_pipeline_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg.connect(sync_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO raw.archivos_descargados (
                       grupo, topico, periodo, anio, mes, nombre_archivo,
                       path_local, source_url, tamanio_bytes
                   ) VALUES ('cmac', 'eeff', 202604, 2026, 4,
                             'C-broken.xls', '/tmp/C-broken.xls', 'https://x', 1000)
                   RETURNING id""",
            )
            archivo_id = cur.fetchone()[0]
        conn.commit()

    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        await mark_archivo_error(
            conn, archivo_id=archivo_id, error_mensaje="ParseError: layout no detectado"
        )
        await conn.commit()

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT status, error_mensaje
                   FROM raw.archivos_descargados WHERE id = %s""",
            (archivo_id,),
        )
        row = cur.fetchone()
        assert row[0] == "error"
        assert "ParseError" in row[1]


async def test_mark_archivo_procesado_no_crashea_con_archivo_id_none(setup_pipeline_schema: str):
    """No-op silencioso cuando el archivo no esta en raw.archivos_descargados.

    Caso real: import manual de un xls local que el operador no descargo
    via el scraper — no hay row en archivos_descargados. El helper debe
    skipear silenciosamente.
    """
    from aibenchef_data.domains.shared import mark_archivo_procesado

    dsn = setup_pipeline_schema
    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        # Esto NO debe levantar excepcion
        await mark_archivo_procesado(conn, archivo_id=None, filas_insertadas=100)


async def test_carga_log_context_stage_invalido_raises(setup_pipeline_schema: str):
    """Validacion de stage: bloquear typos antes de que lleguen a DB."""
    from aibenchef_data.domains.shared import carga_log_context

    factory = _connection_factory(setup_pipeline_schema)

    with pytest.raises(ValueError, match="stage='import_typo' no es válido"):
        async with carga_log_context(factory, stage="import_typo") as _:
            pass


async def test_resolve_archivo_id_encuentra_existente(setup_pipeline_schema: str):
    """resolve_archivo_id debe encontrar archivos registrados por path."""
    from aibenchef_data.domains.shared import resolve_archivo_id

    dsn = setup_pipeline_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    path = "/tmp/X-jl2024.xls"
    with psycopg.connect(sync_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO raw.archivos_descargados (
                       grupo, topico, periodo, anio, mes, nombre_archivo,
                       path_local, source_url, tamanio_bytes
                   ) VALUES ('crac', 'eeff', 202407, 2024, 7,
                             'X-jl2024.xls', %s, 'https://x', 500)
                   RETURNING id""",
                (path,),
            )
            archivo_id = cur.fetchone()[0]
        conn.commit()

    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        found = await resolve_archivo_id(conn, path_local=path)
        assert found == archivo_id

        not_found = await resolve_archivo_id(conn, path_local="/tmp/doesnt-exist.xls")
        assert not_found is None
