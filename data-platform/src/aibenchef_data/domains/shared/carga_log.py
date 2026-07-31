"""Audit trail estructurado para el pipeline de datos (issue #18).

Cada operación del pipeline (scrape, import, refresh-mvs, detectar-cambios)
debe correr dentro de un `carga_log_context` para que quede registrada
en `raw.carga_log` con:

- Estado inicial 'running' al entrar (commit inmediato → persiste aunque crashee)
- Estado final 'success' o 'failed' al salir (commit final)
- Contadores rows_inserted / rows_updated / rows_skipped
- Metadata libre (layout detectado, sheets procesados, etc)
- Correlación con archivo (FK) y/o sync_job (FK)

Cierra G2 del audit de observabilidad (`docs/design/pipeline-observability-v1.md`).

**Decisión de diseño**: el helper usa una conexión SEPARADA del pool para
sus operaciones (INSERT / UPDATE del row de carga_log). Esto evita que
el INSERT 'running' se pierda si la transacción del importer hace rollback.
El caller solo provee el pool/connection-acquirer.

Uso típico::

    from aibenchef_data.infrastructure.db import connection

    async with carga_log_context(
        connection,  # función que acquire conn del pool
        stage="import",
        topico="eeff",
        periodo=202604,
        archivo_id=archivo_uuid,
        triggered_by="cli:gus",
    ) as log:
        async with connection() as conn_work:
            result = await importer.import_file(path)
            await conn_work.commit()
        log.rows_inserted = result.rows_inserted
        log.metadata["layout"] = result.layout_name
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Json

# Stages válidos según docs/design/pipeline-observability-v1.md.
# El CHECK constraint sobre raw.carga_log.status acepta running|success|failed.
VALID_STAGES = frozenset(
    {
        "scrape",
        "import",
        "refresh-mvs",
        "detectar-cambios",
        "backfill",
    }
)


@dataclass
class CargaLogState:
    """Estado mutable expuesto al caller dentro del context manager.

    El caller actualiza estos campos durante la operación; al salir, el
    context manager hace el UPDATE final con los valores finales.
    """

    log_id: int
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_skipped: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@asynccontextmanager
async def carga_log_context(
    connection_factory,
    *,
    stage: str,
    topico: str | None = None,
    periodo: int | None = None,
    archivo_id: UUID | None = None,
    triggered_by: str = "cli",
    sync_job_id: int | None = None,
    source_file: str | None = None,
    initial_metadata: dict[str, Any] | None = None,
):
    """Context manager que envuelve una operación del pipeline con audit log.

    Args:
        connection_factory: Callable async que retorna context manager con
            una conexión psycopg async (típicamente
            `aibenchef_data.infrastructure.db.connection`).
        stage: Etapa del pipeline (debe estar en VALID_STAGES).
        topico: Tópico SBS si aplica (eeff, oficinas, ...).
        periodo: Periodo YYYYMM si aplica.
        archivo_id: UUID del archivo en raw.archivos_descargados si aplica.
        triggered_by: Origen ('cli', 'cron', 'manual:<email>', etc).
        sync_job_id: BIGINT id de admin.sync_jobs si vino de ese flujo.
        source_file: Path o nombre del archivo (compat V007).
        initial_metadata: Metadata pre-poblada antes del run.

    Yields:
        CargaLogState mutable. Modificar sus campos durante la operación.

    Raises:
        ValueError: Si stage no es válido.
        Re-raise cualquier excepción del bloque interno tras marcar 'failed'.
    """
    if stage not in VALID_STAGES:
        raise ValueError(f"stage='{stage}' no es válido. Opciones: {sorted(VALID_STAGES)}")

    # Construir 'source' compatible con V007: usaremos formato
    # "<stage>:<topico>[:<periodo>][:<source_file>]" para distinguir corridas.
    parts = [stage]
    if topico:
        parts.append(topico)
    if periodo:
        parts.append(str(periodo))
    if source_file and not periodo:
        parts.append(source_file)
    source = ":".join(parts)

    initial_meta = initial_metadata or {}

    # INSERT 'running' en conexión separada con commit inmediato. Si el
    # importer luego crashea, el row queda persistido como evidencia.
    async with connection_factory() as conn_audit:
        async with conn_audit.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO raw.carga_log (
                    source, source_file, stage, topico, periodo, archivo_id,
                    triggered_by, sync_job_id, metadata, status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'running')
                RETURNING id
                """,
                (
                    source,
                    source_file,
                    stage,
                    topico,
                    periodo,
                    archivo_id,
                    triggered_by,
                    sync_job_id,
                    Json(initial_meta),
                ),
            )
            row = await cur.fetchone()
            log_id = row[0]
        await conn_audit.commit()

    state = CargaLogState(log_id=log_id, metadata=initial_meta.copy())

    try:
        yield state
    except Exception as exc:
        # Marca como failed en conn separada con commit propio.
        # NO swallow: re-raise para que caller maneje.
        try:
            async with connection_factory() as conn_audit2:
                await _update_log_with_conn(
                    conn_audit2,
                    log_id=log_id,
                    status="failed",
                    state=state,
                    error_message=f"{type(exc).__name__}: {exc}"[:1000],
                )
                await conn_audit2.commit()
        except Exception:
            # Si el UPDATE de error falla, no swallow del error original.
            # El row queda en 'running' — el reaper de V2 lo manejará.
            pass
        raise
    else:
        async with connection_factory() as conn_audit3:
            await _update_log_with_conn(
                conn_audit3,
                log_id=log_id,
                status="success",
                state=state,
            )
            await conn_audit3.commit()


async def _update_log_with_conn(
    conn: psycopg.AsyncConnection,
    *,
    log_id: int,
    status: str,
    state: CargaLogState,
    error_message: str | None = None,
) -> None:
    """Cierra una fila de carga_log con status final y contadores."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE raw.carga_log
               SET finished_at   = now(),
                   status        = %s,
                   rows_inserted = %s,
                   rows_updated  = %s,
                   rows_skipped  = %s,
                   error_message = %s,
                   metadata      = %s
             WHERE id = %s
            """,
            (
                status,
                state.rows_inserted,
                state.rows_updated,
                state.rows_skipped,
                error_message,
                Json(state.metadata),
                log_id,
            ),
        )


async def mark_archivo_procesado(
    conn: psycopg.AsyncConnection,
    *,
    archivo_id: UUID,
    filas_insertadas: int,
) -> None:
    """Marca un archivo como procesado tras un import exitoso.

    Cierra G1 del audit: antes de esta función, ningún importer actualizaba
    raw.archivos_descargados.status='procesado' — quedaba en 'descargado'
    para siempre. Ver `docs/design/pipeline-observability-v1.md`.

    Args:
        conn: Conexión async psycopg.
        archivo_id: UUID del archivo en raw.archivos_descargados.
        filas_insertadas: Cuántas filas se insertaron en raw.<topico>_observacion.

    No-op silencioso si archivo_id es None (caller debe loggear esa señal
    si quiere distinguir "archivo no rastreado" de "archivo procesado").
    """
    if archivo_id is None:
        return
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE raw.archivos_descargados
               SET status           = 'procesado',
                   filas_insertadas = %s,
                   procesado_en     = now(),
                   actualizado_en   = now(),
                   error_mensaje    = NULL
             WHERE id = %s
            """,
            (filas_insertadas, archivo_id),
        )


async def mark_archivo_sospechoso(
    conn: psycopg.AsyncConnection,
    *,
    archivo_id: UUID,
    filas_insertadas: int,
    error_mensaje: str,
) -> None:
    """Marca un archivo como sospechoso: el import termino sin excepcion
    pero el detector post-ingest (raw.detect_partial_ingest) encontro que
    las filas insertadas son muy pocas vs el promedio historico.

    A diferencia de mark_archivo_error, mantenemos filas_insertadas para
    que el admin UI muestre el ratio real (ej. "1,368 de 2,322 esperadas").

    Introducido por V135 tras el incidente C-4103-my2026.xls (jul-2026).
    """
    if archivo_id is None:
        return
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE raw.archivos_descargados
               SET status           = 'sospechoso',
                   filas_insertadas = %s,
                   error_mensaje    = %s,
                   procesado_en     = now(),
                   actualizado_en   = now()
             WHERE id = %s
            """,
            (filas_insertadas, error_mensaje[:500], archivo_id),
        )


async def check_partial_ingest(
    conn: psycopg.AsyncConnection,
    *,
    archivo_id: UUID,
) -> dict[str, object] | None:
    """Corre raw.detect_partial_ingest(archivo_id) y devuelve el JSONB parsed.

    Devuelve None si archivo_id es None o si la funcion aun no existe
    (ej. DB sin V135 aplicada — no rompemos importers viejos).
    """
    if archivo_id is None:
        return None
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT raw.detect_partial_ingest(%s)::text",
                (archivo_id,),
            )
            row = await cur.fetchone()
            if not row or row[0] is None:
                return None
            import json

            parsed = json.loads(row[0])
            return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


async def mark_archivo_error(
    conn: psycopg.AsyncConnection,
    *,
    archivo_id: UUID,
    error_mensaje: str,
) -> None:
    """Marca un archivo como en estado de error tras fallo de import.

    Args:
        conn: Conexión async psycopg.
        archivo_id: UUID del archivo en raw.archivos_descargados.
        error_mensaje: Mensaje truncado a 500 chars para inspección humana.
    """
    if archivo_id is None:
        return
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE raw.archivos_descargados
               SET status         = 'error',
                   error_mensaje  = %s,
                   actualizado_en = now()
             WHERE id = %s
            """,
            (error_mensaje[:500], archivo_id),
        )


async def resolve_archivo_id(
    conn: psycopg.AsyncConnection,
    *,
    path_local: str,
) -> UUID | None:
    """Resuelve el UUID en raw.archivos_descargados desde el path local.

    Usado por el wrapper _import_file_with_audit para amarrar carga_log a archivo.
    Retorna None si el archivo no está registrado (caller decide qué hacer).
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM raw.archivos_descargados WHERE path_local = %s",
            (path_local,),
        )
        row = await cur.fetchone()
        return row[0] if row else None
