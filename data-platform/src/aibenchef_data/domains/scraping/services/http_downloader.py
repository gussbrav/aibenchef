"""HttpxDownloader — descarga un .xls con retry y validacion basica."""

from __future__ import annotations

import time
from typing import Protocol

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from aibenchef_data.domains.shared import ExternalServiceError, get_logger

from ..entities.download_result import DownloadResult, DownloadStatus
from ..entities.download_target import DownloadTarget

log = get_logger(__name__)

# Tamano minimo aceptable de un .xls valido. Bytes mas bajos suelen ser
# paginas de error HTML disfrazadas.
_MIN_VALID_SIZE_BYTES = 2_000


class Downloader(Protocol):
    """Interface del downloader — permite inyectar implementaciones alternativas."""

    async def download(self, target: DownloadTarget) -> DownloadResult: ...


class HttpxDownloader:
    """Descarga via httpx async con reintentos exponenciales."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        max_retries: int = 3,
        skip_if_exists: bool = True,
    ) -> None:
        self._client = client
        self._max_retries = max_retries
        self._skip_if_exists = skip_if_exists

    async def download(self, target: DownloadTarget) -> DownloadResult:
        # Idempotencia: si ya existe y tiene tamano valido, skip.
        if self._skip_if_exists and target.dest.exists():
            size = target.dest.stat().st_size
            if size >= _MIN_VALID_SIZE_BYTES:
                log.debug("download.skip", url=target.url, reason="already_exists")
                return DownloadResult(
                    target=target,
                    status=DownloadStatus.SKIPPED_ALREADY_EXISTS,
                    bytes_written=size,
                    saved_to=target.dest,
                )

        target.dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.dest.with_suffix(target.dest.suffix + ".tmp")
        start = time.perf_counter()

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self._max_retries),
                wait=wait_exponential(multiplier=1.5, min=1, max=15),
                retry=retry_if_exception_type(
                    (httpx.TransportError, httpx.HTTPStatusError),
                ),
                reraise=True,
            ):
                with attempt:
                    return await self._do_download(target, tmp, start)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                log.info("download.not_published", url=target.url)
                return DownloadResult(
                    target=target,
                    status=DownloadStatus.NOT_PUBLISHED,
                    http_status=404,
                    duration_seconds=time.perf_counter() - start,
                )
            log.warning(
                "download.failed",
                url=target.url,
                http_status=e.response.status_code,
            )
            return DownloadResult(
                target=target,
                status=DownloadStatus.FAILED,
                http_status=e.response.status_code,
                error_message=str(e),
                duration_seconds=time.perf_counter() - start,
            )
        except (httpx.TransportError, OSError) as e:
            log.warning("download.failed", url=target.url, error=str(e))
            return DownloadResult(
                target=target,
                status=DownloadStatus.FAILED,
                error_message=str(e),
                duration_seconds=time.perf_counter() - start,
            )
        finally:
            tmp.unlink(missing_ok=True)

        # Unreachable in normal flow (tenacity reraises).
        raise ExternalServiceError(f"Unexpected fallthrough downloading {target.url}")

    async def _do_download(
        self,
        target: DownloadTarget,
        tmp: "Path",
        start: float,
    ) -> DownloadResult:
        async with self._client.stream("GET", target.url) as response:
            response.raise_for_status()
            with tmp.open("wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                    f.write(chunk)

        size = tmp.stat().st_size
        if size < _MIN_VALID_SIZE_BYTES:
            tmp.unlink(missing_ok=True)
            return DownloadResult(
                target=target,
                status=DownloadStatus.FAILED,
                bytes_written=size,
                http_status=200,
                error_message=f"archivo demasiado pequeno ({size} bytes) — posible HTML de error",
                duration_seconds=time.perf_counter() - start,
            )

        tmp.replace(target.dest)
        duration = time.perf_counter() - start
        log.info(
            "download.ok",
            url=target.url,
            bytes=size,
            duration_seconds=round(duration, 2),
        )
        return DownloadResult(
            target=target,
            status=DownloadStatus.OK,
            bytes_written=size,
            duration_seconds=duration,
            http_status=200,
            saved_to=target.dest,
        )


# Local re-export to keep type hint friendly
from pathlib import Path  # noqa: E402
