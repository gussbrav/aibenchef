"""Cuenta — cuenta del plan contable SBS (linea de los EEFF o un indicador).

Los codigos son los REGULATORIOS REALES que SBS publica en sus reportes:
- Balance: (A) total activos, (A1) DISPONIBLE, (A1.1) Caja, (A1.2) Bancos y Corresponsales, ...
- Resultados: (1) INGRESOS FINANCIEROS, (1.1) Disponibles, (1.2) Fondos Interbancarios, ...
- Indicadores: codigos especificos del grupo SOLVENCIA, CALIDAD, etc.

La jerarquia se DERIVA del codigo mismo:
  (A1.1) -> padre es (A1)
  (A1)   -> padre es (A)
  (A)    -> nivel raiz (sin padre)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum


class TipoEstado(StrEnum):
    BALANCE = "balance"
    RESULTADOS = "resultados"
    INDICADOR = "indicador"


# Codigo regulatorio SBS: empieza con letra(s) + numero + .subnumero opcional, todo entre parentesis.
# Ejemplos validos: (A), (A1), (A1.1), (A1.1.2), (B2), (1), (1.1.3)
_CODIGO_RE = re.compile(r"^\(([A-Z]*\d+(?:\.\d+)*)\)\s*(.*)$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Cuenta:
    codigo: str
    nombre: str
    tipo_estado: TipoEstado
    nivel: int
    parent_codigo: str | None
    orden: int
    signo: int = 1
    aplica_a: tuple[str, ...] = field(default_factory=tuple)
    categoria: str | None = None

    @property
    def slug(self) -> str:
        s = self.nombre.lower()
        return "".join(c if c.isalnum() else "_" for c in s).strip("_")[:60]


def parse_label(label: str) -> tuple[str | None, str]:
    """Parsea '(A1.1) Caja' -> ('A1.1', 'Caja').

    Si el label no tiene la forma esperada devuelve (None, label_limpio).
    """
    if not label:
        return None, ""
    m = _CODIGO_RE.match(label.strip())
    if not m:
        return None, label.strip()
    return m.group(1).upper(), m.group(2).strip()


def derive_parent(codigo: str) -> str | None:
    """Dado un codigo regulatorio, devuelve el codigo del padre directo.

    (A1.1.2) -> (A1.1)
    (A1.1)   -> (A1)
    (A1)     -> (A)
    (A)      -> None
    (1.2.3)  -> (1.2)
    (1)      -> None
    """
    if not codigo:
        return None
    if "." in codigo:
        return codigo.rsplit(".", 1)[0]
    # Sin punto: separar prefijo alfabetico del numero. (A1) -> (A), (B23) -> (B), (1) -> None.
    m = re.match(r"^([A-Z]+)(\d+)$", codigo, re.IGNORECASE)
    if not m:
        return None
    prefix, _num = m.groups()
    if not prefix:
        return None
    return prefix.upper()


def derive_nivel(codigo: str) -> int:
    """Profundidad del codigo en el arbol.

    (A) -> 1
    (A1) -> 2
    (A1.1) -> 3
    (A1.1.2) -> 4
    (1) -> 1
    (1.2) -> 2
    """
    if not codigo:
        return 0
    if "." in codigo:
        return codigo.count(".") + (2 if any(c.isalpha() for c in codigo) else 1)
    # Sin punto
    if any(c.isalpha() for c in codigo):
        # (A1) -> nivel 2; (A) -> nivel 1
        return 2 if any(c.isdigit() for c in codigo) else 1
    return 1
