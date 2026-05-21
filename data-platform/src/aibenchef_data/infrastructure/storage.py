"""Storage de archivos crudos descargados (.xls SBS).

Implementacion local por defecto. Cuando agreguemos MinIO/R2, esta clase
se convierte en una interface con LocalStorage y S3CompatibleStorage como
implementaciones intercambiables (Strategy pattern).
"""

from __future__ import annotations

from pathlib import Path

from aibenchef_data.env import settings


class RawStorage:
    """Almacena .xls descargados de SBS organizados por grupo/topico/anio/mes."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or settings().raw_storage_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def path_for(
        self,
        *,
        grupo: str,
        topico: str,
        anio: int,
        mes: int,
        filename: str,
    ) -> Path:
        """Path destino para un archivo."""
        return self.base_dir / grupo / topico / f"{anio:04d}" / f"{mes:02d}" / filename

    def exists(self, path: Path) -> bool:
        return path.exists() and path.stat().st_size > 0
