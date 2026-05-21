"""DownloaderService — orquesta la descarga concurrente de N targets."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence

from aibenchef_data.domains.shared import get_logger

from ..entities.download_result import DownloadResult, DownloadStatus
from ..entities.download_target import DownloadTarget
from .http_downloader import Downloader

log = get_logger(__name__)


class DownloaderService:
    """Coordina la descarga de varios targets con concurrencia limitada."""

    def __init__(self, downloader: Downloader, *, concurrency: int = 8) -> None:
        if concurrency < 1:
            raise ValueError("concurrency must be >= 1")
        self._downloader = downloader
        self._concurrency = concurrency

    async def download_all(
        self,
        targets: Sequence[DownloadTarget],
    ) -> list[DownloadResult]:
        if not targets:
            return []

        semaphore = asyncio.Semaphore(self._concurrency)

        async def _one(t: DownloadTarget) -> DownloadResult:
            async with semaphore:
                return await self._downloader.download(t)

        log.info(
            "batch.start",
            total=len(targets),
            concurrency=self._concurrency,
        )
        results = await asyncio.gather(*[_one(t) for t in targets])
        self._log_summary(results)
        return list(results)

    @staticmethod
    def _log_summary(results: Sequence[DownloadResult]) -> None:
        by_status: dict[str, int] = {}
        total_bytes = 0
        for r in results:
            by_status[r.status.value] = by_status.get(r.status.value, 0) + 1
            total_bytes += r.bytes_written
        log.info(
            "batch.done",
            total=len(results),
            total_mb=round(total_bytes / 1024 / 1024, 2),
            **by_status,
        )

    @staticmethod
    def succeeded(results: Sequence[DownloadResult]) -> list[DownloadResult]:
        return [
            r
            for r in results
            if r.status in (DownloadStatus.OK, DownloadStatus.SKIPPED_ALREADY_EXISTS)
        ]

    @staticmethod
    def failed(results: Sequence[DownloadResult]) -> list[DownloadResult]:
        return [r for r in results if r.status == DownloadStatus.FAILED]
