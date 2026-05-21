"""Cliente Postgres con psycopg async + helpers de transaccion."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from psycopg_pool import AsyncConnectionPool

from aibenchef_data.env import settings

_pool: AsyncConnectionPool | None = None


def _get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        # Convertir postgres+asyncpg:// a postgres:// para psycopg
        url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
        _pool = AsyncConnectionPool(
            conninfo=url,
            min_size=2,
            max_size=10,
            open=False,
        )
    return _pool


async def open_pool() -> None:
    """Inicializar el pool. Llamar una vez al startup de la CLI."""
    pool = _get_pool()
    if pool.closed:
        await pool.open()


async def close_pool() -> None:
    """Cerrar pool al shutdown."""
    pool = _get_pool()
    if not pool.closed:
        await pool.close()


@asynccontextmanager
async def connection() -> AsyncIterator[psycopg.AsyncConnection]:
    """Adquirir conexion del pool. Usa con `async with connection() as conn:`."""
    pool = _get_pool()
    async with pool.connection() as conn:
        yield conn


@asynccontextmanager
async def transaction() -> AsyncIterator[psycopg.AsyncConnection]:
    """Adquirir conexion en transaccion. Auto commit/rollback."""
    async with connection() as conn, conn.transaction():
        yield conn
