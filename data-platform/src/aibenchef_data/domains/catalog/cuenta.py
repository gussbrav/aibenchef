"""Cuenta — cuenta del plan contable SBS (linea de los EEFF o un indicador)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class TipoEstado(StrEnum):
    BALANCE = "balance"           # cuentas del Balance General
    RESULTADOS = "resultados"     # cuentas del Estado de Resultados (GyP / ER)
    INDICADOR = "indicador"       # ratios regulatorios (rentabilidad, liquidez, etc)


@dataclass(frozen=True, slots=True)
class Cuenta:
    """Una cuenta del plan contable SBS, jerarquica.

    `codigo` es sintetico (BG_001, ER_042, IND_LIQUID_005). El nombre real
    viene de los archivos CONSOLIDADO.
    """

    codigo: str
    nombre: str
    tipo_estado: TipoEstado
    nivel: int
    parent_codigo: str | None
    orden: int
    signo: int = 1                              # 1 normal, -1 si la cuenta resta del padre
    aplica_a: tuple[str, ...] = field(default_factory=tuple)
    categoria: str | None = None                 # 'SOLVENCIA', 'RENTABILIDAD' (solo indicadores)

    @property
    def es_padre(self) -> bool:
        return self.nivel == 1

    @property
    def slug(self) -> str:
        s = self.nombre.lower()
        return "".join(c if c.isalnum() else "_" for c in s).strip("_")[:60]
