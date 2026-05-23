"""Helpers compartidos por los BaseXxxImporter.

Centraliza:
- Normalizacion de tipo_entidad
- Conversion de fechas/numeros/texto
- Mapeo flexible de columnas Excel (acentos, mayusculas, encoding latin-1)
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

_TIPO_NORMALIZADO = {
    "BANCOS": "BANCOS",
    "BANCO": "BANCOS",
    "FINANCIERAS": "FINANCIERAS",
    "FINANCIERA": "FINANCIERAS",
    "CMACS": "CMAC",
    "CMAC": "CMAC",
    "CMUNICIPALES": "CMAC",
    "CAJAS MUNICIPALES": "CMAC",
    "CAJA MUNICIPAL": "CMAC",
    "CRACS": "CRAC",
    "CRAC": "CRAC",
    "CAJAS RURALES": "CRAC",
    "CAJA RURAL": "CRAC",
    "EDPYMES": "EDPYMES",
    "EDPYME": "EDPYMES",
}


def normalizar_tipo(t: str | None) -> str:
    """Devuelve uno de BANCOS/FINANCIERAS/CMAC/CRAC/EDPYMES o el original en mayúsculas."""
    if not t:
        return "DESCONOCIDO"
    return _TIPO_NORMALIZADO.get(t.upper().strip(), t.upper().strip())


def to_periodo(value: Any) -> tuple[int, date] | None:
    """Convierte una celda (Datetime/string) a (periodo YYYYMM, fecha_cierre)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    elif isinstance(value, str):
        try:
            d = datetime.fromisoformat(value.split(" ")[0]).date()
        except ValueError:
            return None
    else:
        return None
    return d.year * 100 + d.month, d


def to_numeric(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if not s or s == "-":
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def to_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return None if v != v else int(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    return None


def safe_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return None if not s or s.lower() == "nan" else s
