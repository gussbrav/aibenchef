"""Descarga concurrente de .xls SBS.

Stub minimal. Implementacion completa: Playwright para resolver URLs JS-rendered,
httpx para descargas concurrentes con backoff exponencial.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

logger = structlog.get_logger()


@dataclass
class DownloadRequest:
    url: str
    dest: Path
    entidad_codigo: str
    topico: str
    periodo_yyyymm: int


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    reraise=True,
)
async def download_one(client: httpx.AsyncClient, req: DownloadRequest) -> Path:
    """Descarga un solo .xls con reintentos."""
    logger.info("sbs.download.start", url=req.url, dest=str(req.dest))
    req.dest.parent.mkdir(parents=True, exist_ok=True)

    async with client.stream("GET", req.url, timeout=60) as response:
        response.raise_for_status()
        with req.dest.open("wb") as f:
            async for chunk in response.aiter_bytes(chunk_size=64_000):
                f.write(chunk)

    size = req.dest.stat().st_size
    if size < 1_000:
        req.dest.unlink(missing_ok=True)
        raise ValueError(f"download too small ({size}b) — likely error page")

    logger.info("sbs.download.ok", dest=str(req.dest), size=size)
    return req.dest
