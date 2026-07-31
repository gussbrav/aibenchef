"""Integration tests para el guard anti-carga-parcial (V135).

Cubre el incidente C-4103-my2026.xls (jul-2026): un archivo SBS truncado
que carga solo balance sin resultados y queda como 'procesado' invisible.

Verifica:
- raw.detect_partial_ingest devuelve JSONB con ok/ratio/reason
- Threshold del 60% del promedio historico (3 meses minimos)
- mark_archivo_sospechoso cambia status a 'sospechoso' y guarda mensaje
- Sin historia suficiente (< 3 meses) no marca falso positivo
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import psycopg
import pytest
import pytest_asyncio

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def setup_v135_schema(pg_dsn: str) -> AsyncIterator[str]:
    """Aplica solo lo necesario de V013 + V135 para aislar el guard.

    Fiel al schema real: mismo CHECK constraint que incluye 'sospechoso'
    y misma firma para raw.detect_partial_ingest.
    """
    sync_dsn = pg_dsn.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(sync_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS raw;")
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
                        CHECK (status IN (
                            'descargado','procesando','procesado','error',
                            'omitido','sospechoso','no_publicado_sbs'
                        )),
                    filas_insertadas INT,
                    error_mensaje TEXT,
                    procesado_en TIMESTAMPTZ,
                    descargado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
                    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            # V135: funcion detect_partial_ingest (copia exacta de la migration)
            cur.execute("""
                CREATE OR REPLACE FUNCTION raw.detect_partial_ingest(_archivo_id UUID)
                RETURNS JSONB
                LANGUAGE plpgsql
                STABLE
                AS $$
                DECLARE
                    _grupo        TEXT;
                    _topico       TEXT;
                    _periodo      INT;
                    _rows_actual  INT;
                    _rows_prom    NUMERIC;
                    _n_meses      INT;
                    _ratio        NUMERIC;
                    _threshold    CONSTANT NUMERIC := 0.60;
                    _min_history  CONSTANT INT     := 3;
                BEGIN
                    SELECT grupo, topico, periodo, filas_insertadas
                      INTO _grupo, _topico, _periodo, _rows_actual
                      FROM raw.archivos_descargados
                     WHERE id = _archivo_id;
                    IF NOT FOUND THEN
                        RETURN jsonb_build_object('ok', true, 'reason', 'archivo_no_encontrado');
                    END IF;
                    IF _rows_actual IS NULL OR _rows_actual = 0 THEN
                        RETURN jsonb_build_object(
                            'ok', false,
                            'reason', 'rows_insertadas_null_o_cero',
                            'rows_actual', _rows_actual
                        );
                    END IF;
                    SELECT AVG(filas_insertadas)::NUMERIC, COUNT(*)::INT
                      INTO _rows_prom, _n_meses
                      FROM (
                        SELECT filas_insertadas
                          FROM raw.archivos_descargados
                         WHERE grupo   = _grupo
                           AND topico  = _topico
                           AND periodo < _periodo
                           AND status  = 'procesado'
                           AND filas_insertadas IS NOT NULL
                           AND filas_insertadas > 0
                         ORDER BY periodo DESC
                         LIMIT 6
                      ) sub;
                    IF _n_meses < _min_history OR _rows_prom IS NULL OR _rows_prom = 0 THEN
                        RETURN jsonb_build_object(
                            'ok', true,
                            'reason', 'sin_historia_suficiente',
                            'n_meses_comparados', _n_meses
                        );
                    END IF;
                    _ratio := _rows_actual::NUMERIC / _rows_prom;
                    IF _ratio < _threshold THEN
                        RETURN jsonb_build_object(
                            'ok', false,
                            'reason', 'filas_muy_por_debajo_del_promedio',
                            'ratio', ROUND(_ratio, 4),
                            'threshold', _threshold,
                            'rows_actual', _rows_actual,
                            'rows_promedio', ROUND(_rows_prom, 1),
                            'n_meses_comparados', _n_meses
                        );
                    END IF;
                    RETURN jsonb_build_object(
                        'ok', true,
                        'ratio', ROUND(_ratio, 4),
                        'rows_actual', _rows_actual,
                        'rows_promedio', ROUND(_rows_prom, 1),
                        'n_meses_comparados', _n_meses
                    );
                END;
                $$;
            """)
        conn.commit()
    yield pg_dsn


def _seed_archivo(
    cur,
    *,
    grupo: str,
    topico: str,
    periodo: int,
    filas: int | None,
    status: str = "procesado",
) -> str:
    """Inserta un archivo de prueba y devuelve su UUID."""
    path = f"/tmp/test-{grupo}-{topico}-{periodo}.xls"
    cur.execute(
        """INSERT INTO raw.archivos_descargados (
               grupo, topico, periodo, anio, mes, nombre_archivo,
               path_local, source_url, tamanio_bytes,
               status, filas_insertadas
           ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'https://x', 1000, %s, %s)
           RETURNING id""",
        (
            grupo,
            topico,
            periodo,
            periodo // 100,
            periodo % 100,
            f"test-{periodo}.xls",
            path,
            status,
            filas,
        ),
    )
    return cur.fetchone()[0]


async def test_detect_partial_ingest_sin_historia_suficiente_es_ok(setup_v135_schema: str):
    """Con menos de 3 meses de historia, el detector no marca sospechoso."""
    sync_dsn = setup_v135_schema.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        # 2 meses de historia + 1 archivo evaluado = insuficiente
        _seed_archivo(cur, grupo="edpyme", topico="eeff", periodo=202603, filas=2322)
        _seed_archivo(cur, grupo="edpyme", topico="eeff", periodo=202604, filas=2322)
        actual_id = _seed_archivo(cur, grupo="edpyme", topico="eeff", periodo=202605, filas=100)
        conn.commit()

        cur.execute("SELECT raw.detect_partial_ingest(%s)::text", (actual_id,))
        import json

        result = json.loads(cur.fetchone()[0])
        assert result["ok"] is True
        assert result["reason"] == "sin_historia_suficiente"
        assert result["n_meses_comparados"] == 2


async def test_detect_partial_ingest_marca_sospechoso_caso_c4103(setup_v135_schema: str):
    """Reproduce el incidente real: 4 meses de historia con ~2322 filas +
    un archivo actual con 1368 (ratio 0.59 < threshold 0.60)."""
    sync_dsn = setup_v135_schema.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        for periodo in (202601, 202602, 202603, 202604):
            _seed_archivo(cur, grupo="edpyme", topico="eeff", periodo=periodo, filas=2322)
        actual_id = _seed_archivo(cur, grupo="edpyme", topico="eeff", periodo=202605, filas=1368)
        conn.commit()

        cur.execute("SELECT raw.detect_partial_ingest(%s)::text", (actual_id,))
        import json

        result = json.loads(cur.fetchone()[0])
        assert result["ok"] is False
        assert result["reason"] == "filas_muy_por_debajo_del_promedio"
        assert result["rows_actual"] == 1368
        assert float(result["rows_promedio"]) == 2322.0
        assert float(result["ratio"]) < 0.60
        assert result["n_meses_comparados"] == 4


async def test_detect_partial_ingest_carga_normal_es_ok(setup_v135_schema: str):
    """Un archivo con filas coherentes con el promedio devuelve ok=true."""
    sync_dsn = setup_v135_schema.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        for periodo in (202601, 202602, 202603):
            _seed_archivo(cur, grupo="cmac", topico="eeff", periodo=periodo, filas=2322)
        actual_id = _seed_archivo(cur, grupo="cmac", topico="eeff", periodo=202604, filas=2300)
        conn.commit()

        cur.execute("SELECT raw.detect_partial_ingest(%s)::text", (actual_id,))
        import json

        result = json.loads(cur.fetchone()[0])
        assert result["ok"] is True
        assert float(result["ratio"]) > 0.9


async def test_detect_partial_ingest_filas_cero_falla(setup_v135_schema: str):
    """filas_insertadas = 0 se detecta como carga fallida."""
    sync_dsn = setup_v135_schema.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        actual_id = _seed_archivo(cur, grupo="bancos", topico="eeff", periodo=202605, filas=0)
        conn.commit()

        cur.execute("SELECT raw.detect_partial_ingest(%s)::text", (actual_id,))
        import json

        result = json.loads(cur.fetchone()[0])
        assert result["ok"] is False
        assert result["reason"] == "rows_insertadas_null_o_cero"


async def test_mark_archivo_sospechoso_persiste_status_y_mensaje(setup_v135_schema: str):
    """mark_archivo_sospechoso cambia status y guarda diagnostico."""
    from aibenchef_data.domains.shared import mark_archivo_sospechoso

    dsn = setup_v135_schema
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        archivo_id = _seed_archivo(cur, grupo="edpyme", topico="eeff", periodo=202605, filas=1368)
        conn.commit()

    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        await mark_archivo_sospechoso(
            conn,
            archivo_id=archivo_id,
            filas_insertadas=1368,
            error_mensaje="Carga sospechosa (ratio=0.59, prom=2322)",
        )
        await conn.commit()

    with psycopg.connect(sync_dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT status, filas_insertadas, error_mensaje "
            "FROM raw.archivos_descargados WHERE id = %s",
            (archivo_id,),
        )
        row = cur.fetchone()
        assert row[0] == "sospechoso"
        assert row[1] == 1368
        assert "ratio=0.59" in row[2]
