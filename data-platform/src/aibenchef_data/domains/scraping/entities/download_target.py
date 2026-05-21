"""DownloadTarget — descripcion inmutable de un archivo a descargar de SBS."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from aibenchef_data.domains.catalog import SbsFileRef


@dataclass(frozen=True, slots=True)
class DownloadTarget:
    """Una unidad de trabajo del downloader."""

    ref: SbsFileRef
    url: str
    dest: Path

    @property
    def filename(self) -> str:
        return self.ref.filename
