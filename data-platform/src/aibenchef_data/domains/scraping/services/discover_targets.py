"""DiscoverTargets — planificador de descargas para un periodo."""

from __future__ import annotations

from aibenchef_data.domains.catalog import Grupo, Periodo, SbsUrlBuilder, Topico
from aibenchef_data.infrastructure.storage import RawStorage

from ..entities.download_target import DownloadTarget


class DiscoverTargets:
    """Genera la lista de DownloadTarget para un periodo dado."""

    def __init__(self, *, storage: RawStorage, base_url: str) -> None:
        self._storage = storage
        self._base_url = base_url

    def for_periodo(
        self,
        periodo: Periodo,
        *,
        grupos: list[Grupo] | None = None,
        topicos: list[Topico] | None = None,
    ) -> list[DownloadTarget]:
        """Lista todos los targets validos para el periodo."""
        refs = SbsUrlBuilder.all_for_periodo(periodo, grupos=grupos, topicos=topicos)
        targets: list[DownloadTarget] = []
        for ref in refs:
            dest = self._storage.path_for(
                grupo=ref.grupo.value,
                topico=ref.topico.value,
                anio=ref.periodo.anio,
                mes=ref.periodo.mes,
                filename=ref.filename,
            )
            targets.append(
                DownloadTarget(
                    ref=ref,
                    url=ref.url(self._base_url),
                    dest=dest,
                )
            )
        return targets
