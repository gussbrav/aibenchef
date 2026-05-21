"""EntidadesCatalog — repositorio in-memory cargado de seed JSON.

Estrategia: el catalogo inicial vive en seeds/entidades.json (committed al repo).
Cuando agreguemos el scrape de la pagina de "listado SBS", actualizamos el seed.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import asdict
from pathlib import Path

from aibenchef_data.domains.shared import NotFoundError

from ..entidad import Entidad
from ..enums import Grupo


class EntidadesCatalog:
    """Repositorio in-memory de entidades SBS."""

    def __init__(self, entidades: Iterable[Entidad]) -> None:
        self._by_code: dict[str, Entidad] = {e.codigo_sbs: e for e in entidades}

    # ---------- factories ----------
    @classmethod
    def from_seed_file(cls, path: Path) -> EntidadesCatalog:
        raw = json.loads(path.read_text(encoding="utf-8"))
        entidades = [
            Entidad(
                codigo_sbs=row["codigo_sbs"],
                nombre=row["nombre"],
                grupo=Grupo(row["grupo"]),
                nombre_corto=row.get("nombre_corto"),
                es_microfinanciera=row.get("es_microfinanciera", False),
                activa=row.get("activa", True),
                ruc=row.get("ruc"),
            )
            for row in raw
        ]
        return cls(entidades)

    @classmethod
    def default(cls) -> EntidadesCatalog:
        """Cargar el seed por defecto bundleado con el paquete."""
        here = Path(__file__).resolve()
        seed_path = here.parent.parent.parent.parent.parent.parent / "seeds" / "entidades.json"
        if not seed_path.exists():
            return cls([])
        return cls.from_seed_file(seed_path)

    # ---------- queries ----------
    def by_codigo(self, codigo: str) -> Entidad:
        ent = self._by_code.get(codigo)
        if ent is None:
            raise NotFoundError(f"Entidad no encontrada: {codigo}")
        return ent

    def list(self, *, grupo: Grupo | None = None, solo_activas: bool = True) -> list[Entidad]:
        result = self._by_code.values()
        if grupo is not None:
            result = (e for e in result if e.grupo == grupo)
        if solo_activas:
            result = (e for e in result if e.activa)
        return sorted(result, key=lambda e: (e.grupo.value, e.nombre))

    def __len__(self) -> int:
        return len(self._by_code)

    # ---------- serializacion ----------
    def to_seed_dict_list(self) -> list[dict]:
        return [asdict(e) for e in self._by_code.values()]
