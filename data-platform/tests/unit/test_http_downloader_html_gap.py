"""Tests del HttpxDownloader — issue #3.

Cubre el comportamiento del downloader cuando SBS retorna HTTP 200 con un
HTML de error pequeño (caso real: B-2303-fe2024.xls oficinas BANCOS).

REGRESION del bug: antes esto se marcaba como FAILED (gap silencioso en el
dashboard). Ahora debe marcarse como NOT_PUBLISHED para que el panel
diferencie "SBS no publico" de "descarga fallo por error tecnico".
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from aibenchef_data.domains.scraping.entities.download_result import DownloadStatus
from aibenchef_data.domains.scraping.entities.download_target import DownloadTarget
from aibenchef_data.domains.scraping.services.http_downloader import HttpxDownloader


def _make_target(tmp_path: Path) -> DownloadTarget:
    """DownloadTarget minimo para tests."""
    from aibenchef_data.domains.catalog import Grupo, Periodo, SbsUrlBuilder, Topico

    ref = SbsUrlBuilder.build(Grupo.BANCA_MULTIPLE, Topico.OFICINAS, Periodo(2024, 2))
    return DownloadTarget(
        ref=ref,
        url="https://intranet2.sbs.gob.pe/test/B-2303-fe2024.xls",
        dest=tmp_path / "B-2303-fe2024.xls",
    )


class TestHtmlGap:
    """Caso de uso del bug #3: SBS retorna 200 + HTML pequeño = no publicado."""

    @pytest.mark.asyncio
    async def test_html_pequeno_se_marca_como_not_published(self, tmp_path: Path) -> None:
        """REGRESION issue #3: el caso B-2303-fe2024.xls real.

        SBS retorna HTTP 200 con un cuerpo HTML de ~165 bytes cuando no tiene
        el archivo publicado. Antes esto se marcaba como FAILED (mismo bucket
        que errores 5xx o transport errors). Ahora debe ser NOT_PUBLISHED.
        """

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"<html><body>Error: file not found</body></html>")

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=False)
            target = _make_target(tmp_path)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.NOT_PUBLISHED, (
            f"Esperaba NOT_PUBLISHED, obtuve {result.status} — gap silencioso!"
        )
        assert result.http_status == 200
        assert result.bytes_written < 1024
        assert "no publico" in (result.error_message or "").lower()

    @pytest.mark.asyncio
    async def test_404_sigue_siendo_not_published(self, tmp_path: Path) -> None:
        """Sanity check: el caso 404 clasico sigue funcionando."""

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=False)
            target = _make_target(tmp_path)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.NOT_PUBLISHED
        assert result.http_status == 404

    @pytest.mark.asyncio
    async def test_archivo_normal_se_descarga_ok(self, tmp_path: Path) -> None:
        """Sanity check: un archivo > 1024 bytes con HTTP 200 sigue siendo OK."""
        body = b"x" * 2048  # 2 KB

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=body)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=False)
            target = _make_target(tmp_path)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.OK
        assert result.bytes_written == 2048
