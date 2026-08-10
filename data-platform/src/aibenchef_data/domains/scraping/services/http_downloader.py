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

# Magic bytes que identifican formatos validos aceptados por SBS:
#   - BIFF/OLE2 compound (xls tradicional): D0 CF 11 E0
#   - ZIP/XLSX (Office Open XML): 50 4B (PK)
# Cualquier body que NO empiece con estos bytes se considera basura
# (tipicamente HTML de error con status 200 que SBS devuelve cuando el
# archivo aun no existe o el sitio esta en modo maintenance).
_XLS_MAGIC_BYTES = (b"\xd0\xcf\x11\xe0",)
_XLSX_MAGIC_BYTES = (b"PK\x03\x04",)
# HTML explicito para deteccion negativa (log claro del motivo).
_HTML_MARKERS = (b"<html", b"<!doctype", b"<HTML", b"<!DOCTYPE")


def _is_valid_office_file(header: bytes) -> bool:
    """True si el header matchea magic bytes de xls o xlsx."""
    if not header:
        return False
    for magic in _XLS_MAGIC_BYTES + _XLSX_MAGIC_BYTES:
        if header.startswith(magic):
            return True
    return False


def _looks_like_html(header: bytes) -> bool:
    """True si el header sugiere HTML — tipicamente pagina de error SBS."""
    if not header:
        return False
    head_stripped = header.lstrip()
    return any(head_stripped.startswith(m) for m in _HTML_MARKERS)


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
        # Idempotencia: si ya existe, tiene tamano valido Y magic bytes de
        # xls/xlsx, skip. Si el archivo existe pero es HTML basura (bug
        # historico donde SBS respondio 200 con HTML de error), lo tratamos
        # como si no existiera — asi el retry lo re-descarga y (con el
        # magic byte check en _do_download) lo marca como NOT_PUBLISHED
        # correctamente en lugar de guardar mas basura.
        if self._skip_if_exists and target.dest.exists():
            size = target.dest.stat().st_size
            if size >= _MIN_VALID_SIZE_BYTES:
                try:
                    with target.dest.open("rb") as f:
                        header = f.read(8)
                    if _is_valid_office_file(header):
                        log.debug("download.skip", url=target.url, reason="already_exists")
                        return DownloadResult(
                            target=target,
                            status=DownloadStatus.SKIPPED_ALREADY_EXISTS,
                            bytes_written=size,
                            saved_to=target.dest,
                        )
                    # Header NO es xls/xlsx — probable HTML basura legacy.
                    # Borramos y forzamos re-descarga.
                    log.warning(
                        "download.invalid_cache",
                        url=target.url,
                        reason="html_or_garbage_on_disk",
                        size=size,
                    )
                    target.dest.unlink(missing_ok=True)
                except OSError:
                    # Si no podemos leer el header, mejor re-descargar.
                    target.dest.unlink(missing_ok=True)

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
        tmp: Path,
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
            # SBS devuelve HTTP 200 con un HTML de error (~165 bytes) cuando
            # un periodo no fue publicado. Semanticamente equivalente al 404
            # — los marcamos como NOT_PUBLISHED para que el dashboard lo
            # diferencie de un FAILED real (issue #3).
            log.info(
                "download.not_published",
                url=target.url,
                reason="html_error_response",
                size=size,
            )
            return DownloadResult(
                target=target,
                status=DownloadStatus.NOT_PUBLISHED,
                bytes_written=size,
                http_status=200,
                error_message=f"SBS no publico este periodo (HTML de error, {size} bytes)",
                duration_seconds=time.perf_counter() - start,
            )

        # Validacion por magic bytes: SBS ocasionalmente devuelve 200 con
        # HTML de error grande (>2KB) — payload de sitio en mantenimiento,
        # o pagina de "recurso no disponible". Sin este check, guardabamos
        # HTML basura con extension .xls y skip_if_exists lo bloqueaba
        # eternamente en runs posteriores. Ahora validamos que el header
        # sea xls (BIFF/OLE2) o xlsx (ZIP) — cualquier otra cosa se marca
        # como NOT_PUBLISHED (no como FAILED, porque la causa es SBS).
        try:
            with tmp.open("rb") as f:
                header = f.read(8)
        except OSError:
            header = b""
        if not _is_valid_office_file(header):
            tmp.unlink(missing_ok=True)
            reason = "html_response_masquerading_as_xls" if _looks_like_html(header) else "unknown_format"
            log.info(
                "download.not_published",
                url=target.url,
                reason=reason,
                size=size,
                header_hex=header.hex() if header else "",
            )
            return DownloadResult(
                target=target,
                status=DownloadStatus.NOT_PUBLISHED,
                bytes_written=size,
                http_status=200,
                error_message=(
                    f"SBS respondio 200 pero el body NO es xls/xlsx valido "
                    f"({reason}, {size} bytes) — probable pagina de error"
                ),
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
