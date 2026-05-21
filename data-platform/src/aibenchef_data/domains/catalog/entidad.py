"""Entidad — institucion regulada por la SBS."""

from __future__ import annotations

from dataclasses import dataclass

from .enums import Grupo
from .periodo import Periodo


@dataclass(frozen=True, slots=True)
class Entidad:
    """Una entidad regulada por la SBS (banco, CMAC, financiera, etc).

    Inmutable. El catalogo se carga desde seed JSON al startup y se enriquece
    tras el primer scrape exitoso del listado oficial.
    """

    codigo_sbs: str
    nombre: str
    grupo: Grupo
    nombre_corto: str | None = None
    es_microfinanciera: bool = False
    activa: bool = True
    ruc: str | None = None
    fecha_inicio: Periodo | None = None
    fecha_fin: Periodo | None = None

    @property
    def slug(self) -> str:
        """Slug url-safe del nombre (para paths de almacenamiento)."""
        base = (self.nombre_corto or self.nombre).lower()
        return (
            base.replace(" ", "-")
            .replace(".", "")
            .replace(",", "")
            .replace("/", "-")
            .replace("--", "-")
        )

    def activa_en(self, periodo: Periodo) -> bool:
        """Si la entidad estaba operativa en el periodo dado."""
        if self.fecha_inicio and periodo < self.fecha_inicio:
            return False
        if self.fecha_fin and periodo > self.fecha_fin:
            return False
        return self.activa
