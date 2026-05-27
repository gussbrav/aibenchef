"""Catalog services — operaciones sobre cabecera_maestra y compare con archivos."""

from .estructura_diff import (
    EstructuraDiff,
    compare_periodo_vs_cabecera,
)

__all__ = [
    "EstructuraDiff",
    "compare_periodo_vs_cabecera",
]
