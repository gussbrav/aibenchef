"""Domain scraping — descarga concurrente de .xls SBS.

Public API:
- DownloadTarget: que bajar
- DownloadResult: resultado de una descarga
- DiscoverTargets: planifica descargas para un periodo
- HttpxDownloader: implementacion del descargador con httpx + retry
- DownloaderService: orquestador con concurrencia limitada
"""

from .entities.download_result import DownloadResult, DownloadStatus
from .entities.download_target import DownloadTarget
from .services.discover_targets import DiscoverTargets
from .services.downloader_service import DownloaderService
from .services.http_downloader import HttpxDownloader

__all__ = [
    "DiscoverTargets",
    "DownloadResult",
    "DownloadStatus",
    "DownloadTarget",
    "DownloaderService",
    "HttpxDownloader",
]
