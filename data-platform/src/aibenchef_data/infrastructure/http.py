"""Factory de cliente HTTP httpx con configuracion sensata para SBS."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from aibenchef_data.env import settings


@asynccontextmanager
async def sbs_http_client() -> AsyncIterator[httpx.AsyncClient]:
    """Cliente httpx async con User-Agent + timeout SBS-friendly.

    Uso:
        async with sbs_http_client() as client:
            ...
    """
    cfg = settings()
    timeout = httpx.Timeout(
        connect=10.0,
        read=cfg.sbs_download_timeout_seconds,
        write=10.0,
        pool=5.0,
    )
    limits = httpx.Limits(
        max_connections=cfg.sbs_download_concurrency * 2,
        max_keepalive_connections=cfg.sbs_download_concurrency,
    )
    async with httpx.AsyncClient(
        headers={
            "User-Agent": cfg.sbs_user_agent,
            "Accept": "*/*",
        },
        timeout=timeout,
        limits=limits,
        follow_redirects=True,
        http2=False,  # intranet2.sbs.gob.pe es HTTP/1.1
    ) as client:
        yield client
