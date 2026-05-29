"""Integration tests para raw.eeff_celda_cruda — V113 (issue #65).

Verifica el contrato de escritura del importer hacia la tabla nueva, sin
correr import_file completo (que requeriria fixture .xls + cabecera_maestra
+ dim_cuenta + dim_cuenta_alias). Tests aislados al path nuevo.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import psycopg
import pytest
import pytest_asyncio

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def setup_celda_cruda_schema(pg_dsn: str) -> AsyncIterator[str]:
    """Aplica raw.eeff_celda_cruda + tabla minima archivos_descargados + helper dw.normalizar_entidad.

    Aisla el test del resto del esquema — solo lo necesario para upsert.
    """
    sync_dsn = pg_dsn.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(sync_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS raw;")
            cur.execute("CREATE SCHEMA IF NOT EXISTS dw;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS raw.archivos_descargados (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    grupo TEXT NOT NULL, topico TEXT NOT NULL, periodo INT NOT NULL,
                    anio INT NOT NULL, mes INT NOT NULL,
                    nombre_archivo TEXT NOT NULL,
                    path_local TEXT NOT NULL UNIQUE,
                    source_url TEXT NOT NULL, tamanio_bytes BIGINT NOT NULL,
                    descargado_en TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            # Stub identidad para mantener compatibilidad con el INSERT del importer
            # (en prod normalizar_entidad strip footnote markers; aca devolvemos
            # input intacto para no enmascarar bugs).
            cur.execute("""
                CREATE OR REPLACE FUNCTION dw.normalizar_entidad(s TEXT)
                RETURNS TEXT AS $$ SELECT s $$ LANGUAGE SQL IMMUTABLE;
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS raw.eeff_celda_cruda (
                    id BIGSERIAL PRIMARY KEY,
                    periodo INTEGER NOT NULL,
                    nomb_correg TEXT NOT NULL,
                    tipo_entidad TEXT NOT NULL,
                    tipo_estado TEXT NOT NULL
                        CHECK (tipo_estado IN ('balance', 'resultados')),
                    orden INTEGER NOT NULL,
                    es_header BOOLEAN NOT NULL DEFAULT FALSE,
                    nombre_archivo TEXT NOT NULL,
                    valor_mn NUMERIC(20, 4),
                    valor_me NUMERIC(20, 4),
                    valor_total NUMERIC(20, 4),
                    archivo_id UUID REFERENCES raw.archivos_descargados(id) ON DELETE SET NULL,
                    source_file TEXT,
                    cuenta_codigo TEXT,
                    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT eeff_celda_cruda_uniq
                        UNIQUE (periodo, nomb_correg, tipo_estado, orden)
                );
            """)
        conn.commit()
    yield pg_dsn


async def test_copy_batch_celdas_inserta_filas(setup_celda_cruda_schema: str):
    """Verifica que _copy_batch_celdas inserta filas con los 3 valores monetarios."""
    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        MonthlyEeffImporter,
    )

    dsn = setup_celda_cruda_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        importer = MonthlyEeffImporter(conn)
        # Batch sintetico: 2 filas, una con TOTAL nulo (caso BANCOS) y otra
        # con los 3 valores presentes (caso CMAC).
        await importer._copy_batch_celdas(
            [
                (
                    202604,
                    "Banco Test",
                    "BANCOS",
                    "balance",
                    5,
                    False,
                    "Disponible",
                    1000.5,
                    250.0,
                    None,  # BANCOS no publica TOTAL
                    None,
                    "B-test.xls",
                    "A1",  # cuenta_codigo (V114)
                ),
                (
                    202604,
                    "CMAC Test",
                    "CMAC",
                    "balance",
                    5,
                    False,
                    "Disponible",
                    800.0,
                    100.0,
                    900.0,  # CMAC sí publica TOTAL crudo
                    None,
                    "C-test.xls",
                    "A1",  # cuenta_codigo (V114)
                ),
            ]
        )

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT nomb_correg, valor_mn, valor_me, valor_total
            FROM raw.eeff_celda_cruda
            WHERE periodo = 202604 AND orden = 5
            ORDER BY nomb_correg
        """)
        rows = cur.fetchall()
        assert len(rows) == 2
        # Banco Test (TOTAL crudo NULL — SBS no lo publica)
        assert rows[0][0] == "Banco Test"
        assert float(rows[0][1]) == 1000.5
        assert float(rows[0][2]) == 250.0
        assert rows[0][3] is None
        # CMAC Test (TOTAL crudo = 900)
        assert rows[1][0] == "CMAC Test"
        assert float(rows[1][3]) == 900.0


async def test_copy_batch_celdas_upsert_actualiza_valores(
    setup_celda_cruda_schema: str,
):
    """Re-import del mismo (periodo, entidad, tipo_estado, orden) actualiza,
    no duplica. Si el parser corre dos veces sobre el mismo archivo (re-trigger
    manual o backfill), la tabla queda consistente."""
    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        MonthlyEeffImporter,
    )

    dsn = setup_celda_cruda_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        importer = MonthlyEeffImporter(conn)
        # Primera corrida — valor 100
        await importer._copy_batch_celdas(
            [
                (
                    202604,
                    "Test S.A.",
                    "BANCOS",
                    "balance",
                    1,
                    False,
                    "Caja",
                    100.0,
                    0.0,
                    None,
                    None,
                    "first.xls",
                    "A1.1",
                ),
            ]
        )
        # Segunda corrida sobre la misma key — valor distinto (ej. SBS corrigio)
        await importer._copy_batch_celdas(
            [
                (
                    202604,
                    "Test S.A.",
                    "BANCOS",
                    "balance",
                    1,
                    False,
                    "Caja",
                    150.0,
                    0.0,
                    None,
                    None,
                    "second.xls",
                    "A1.1",
                ),
            ]
        )

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*), MAX(valor_mn::float8), MAX(source_file)
            FROM raw.eeff_celda_cruda
            WHERE periodo = 202604 AND nomb_correg = 'Test S.A.'
              AND tipo_estado = 'balance' AND orden = 1
        """)
        cnt, valor_mn, src = cur.fetchone()
        assert cnt == 1  # NO duplica
        assert valor_mn == 150.0  # ACTUALIZA
        assert src == "second.xls"


async def test_copy_batch_celdas_batch_vacio_es_noop(setup_celda_cruda_schema: str):
    """Llamar con [] no debe crear nada ni fallar."""
    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        MonthlyEeffImporter,
    )

    dsn = setup_celda_cruda_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        importer = MonthlyEeffImporter(conn)
        result = await importer._copy_batch_celdas([])
        assert result == 0

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM raw.eeff_celda_cruda")
        assert cur.fetchone()[0] == 0


async def test_import_file_accepta_archivo_id_kwarg(setup_celda_cruda_schema: str):
    """API contract: import_file debe aceptar archivo_id sin romper signature.

    Test minimo de regresion para la integracion con _import_file_with_audit
    (cli.py) que llama con kwarg archivo_id desde V113 en adelante.
    """
    from inspect import signature

    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        MonthlyEeffImporter,
    )

    sig = signature(MonthlyEeffImporter.import_file)
    assert "archivo_id" in sig.parameters
    # Default debe ser None para mantener backward compatibility con callers
    # que no pasan el kwarg (import puntual de un xls local).
    assert sig.parameters["archivo_id"].default is None
