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
        """Sanity check: un archivo > 1024 bytes CON magic bytes xls valido = OK.

        Actualizado (V157): el downloader ahora valida magic bytes tras la
        descarga — el body debe empezar con BIFF/OLE2 (xls) o ZIP (xlsx),
        sino se marca NOT_PUBLISHED (probable HTML basura enmascarado).
        """
        # BIFF/OLE2 magic + padding hasta 2 KB — simula un xls tradicional real.
        body = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 2040

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=body)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=False)
            target = _make_target(tmp_path)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.OK
        assert result.bytes_written == 2048

    @pytest.mark.asyncio
    async def test_html_grande_enmascarado_como_xls_se_marca_not_published(
        self, tmp_path: Path
    ) -> None:
        """REGRESION V157: SBS a veces devuelve HTML de error >2KB con status 200.

        Antes del magic byte check, se guardaba como .xls valido y
        skip_if_exists bloqueaba re-descargas para siempre. Ahora debe
        marcarse NOT_PUBLISHED por header invalido.
        """
        # HTML de ~5 KB — pasa el check de size (>2000) pero NO empieza con
        # magic byte de xls/xlsx.
        body = (
            b"<html><head><title>Error</title></head><body>"
            b"<h1>Recurso no disponible</h1>" + b"<p>Padding</p>" * 200 + b"</body></html>"
        )
        assert len(body) > 2000, "test setup: body debe pasar el min_size"

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=body)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=False)
            target = _make_target(tmp_path)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.NOT_PUBLISHED, (
            f"Esperaba NOT_PUBLISHED por magic byte invalido, obtuve {result.status}"
        )
        assert "html_response_masquerading" in (result.error_message or "")

    @pytest.mark.asyncio
    async def test_xlsx_zip_magic_byte_se_descarga_ok(self, tmp_path: Path) -> None:
        """XLSX (ZIP) es un formato valido igual que XLS tradicional."""
        # ZIP magic (PK\x03\x04) + padding
        body = b"PK\x03\x04" + b"\x00" * 2044

        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=body)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=False)
            target = _make_target(tmp_path)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.OK

    @pytest.mark.asyncio
    async def test_skip_if_exists_invalida_html_basura_en_disco(self, tmp_path: Path) -> None:
        """REGRESION V157: si en disco hay HTML basura legacy (bug historico),
        skip_if_exists lo detecta y fuerza re-descarga en lugar de saltarlo.
        """
        # Pre-poblar el destino con HTML basura >2 KB (simula archivos legacy
        # que se guardaron antes del fix del magic byte check).
        target = _make_target(tmp_path)
        target.dest.parent.mkdir(parents=True, exist_ok=True)
        target.dest.write_bytes(b"<html>garbage</html>" + b"x" * 3000)

        # Handler devuelve xls valido en la re-descarga forzada.
        good_body = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 2040
        calls = {"n": 0}

        async def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(200, content=good_body)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            # skip_if_exists=True es el default; validamos que aun asi re-descarga
            downloader = HttpxDownloader(client, max_retries=1, skip_if_exists=True)
            result = await downloader.download(target)

        assert result.status == DownloadStatus.OK, (
            f"Esperaba re-descarga, obtuve {result.status} — HTML basura no invalidado"
        )
        assert calls["n"] == 1, "El downloader debio hacer HTTP GET pese al file existente"
