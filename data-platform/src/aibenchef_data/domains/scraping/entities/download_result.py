"""DownloadResult — resultado de una descarga individual."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from .download_target import DownloadTarget


class DownloadStatus(StrEnum):
    OK = "ok"
    SKIPPED_ALREADY_EXISTS = "skipped_already_exists"
    NOT_PUBLISHED = "not_published"          # 404 -> el periodo aun no se publico
    FAILED = "failed"                         # error tras reintentos


@dataclass(frozen=True, slots=True)
class DownloadResult:
    target: DownloadTarget
    status: DownloadStatus
    bytes_written: int = 0
    duration_seconds: float = 0.0
    http_status: int | None = None
    error_message: str | None = None
    saved_to: Path | None = None
