"""Deteccion del formato real de un archivo .xls que publica la SBS.

SBS mezcla dos formatos bajo la misma extension .xls:
- BIFF (Excel 97-2003 binario)  -> magic 0xD0 0xCF 0x11 0xE0
- OOXML (Excel 2007+ zip)       -> magic 0x50 0x4B 0x03 0x04  (PK\x03\x04)
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path


class XlsFormat(StrEnum):
    BIFF = "biff"     # .xls binario clasico (lee xlrd)
    OOXML = "ooxml"   # .xlsx (lee openpyxl)
    UNKNOWN = "unknown"


def detect_xls_format(path: Path) -> XlsFormat:
    """Lee los primeros 8 bytes y resuelve el formato real."""
    with path.open("rb") as f:
        head = f.read(8)
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return XlsFormat.BIFF
    if head.startswith(b"PK\x03\x04"):
        return XlsFormat.OOXML
    return XlsFormat.UNKNOWN
