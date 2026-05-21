"""Deteccion del formato real de un archivo .xls que publica la SBS.

SBS mezcla varios formatos bajo la misma extension .xls:
- BIFF (Excel 97-2003 binario)     -> magic 0xD0 0xCF 0x11 0xE0   -> xlrd
- XLSX (Excel 2007+ OOXML zip)     -> magic 0x50 0x4B + xl/workbook.xml -> openpyxl
- XLSB (Excel Binary Workbook zip) -> magic 0x50 0x4B + xl/workbook.bin -> pyxlsb
- HTML (tabla HTML disfrazada)     -> magic '<' (<html, <table, <!DOCTYPE) -> BeautifulSoup
- SpreadsheetML XML 2003           -> magic '<?xml' + 'urn:schemas-microsoft-com:office'
"""

from __future__ import annotations

import zipfile
from enum import StrEnum
from pathlib import Path


class XlsFormat(StrEnum):
    BIFF = "biff"
    XLSX = "xlsx"
    XLSB = "xlsb"
    HTML = "html"
    XML2003 = "xml2003"
    UNKNOWN = "unknown"


def detect_xls_format(path: Path) -> XlsFormat:
    """Detecta el formato real de un archivo (no se fia de la extension)."""
    with path.open("rb") as f:
        head = f.read(2048)

    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return XlsFormat.BIFF

    if head.startswith(b"PK\x03\x04"):
        # Es un ZIP. Distinguir xlsx vs xlsb mirando los nombres internos.
        try:
            with zipfile.ZipFile(path) as zf:
                names = set(zf.namelist())
                has_bin = any(n.startswith("xl/") and n.endswith(".bin") for n in names)
                has_xml = "xl/workbook.xml" in names
                if has_bin and not has_xml:
                    return XlsFormat.XLSB
                if has_xml:
                    return XlsFormat.XLSX
                if has_bin:
                    return XlsFormat.XLSB
        except zipfile.BadZipFile:
            pass
        return XlsFormat.XLSX  # fallback razonable para zip valido sin pistas claras

    sample = head.lstrip()
    if sample[:1] == b"<":
        if sample[:5].lower() == b"<?xml" and (
            b"urn:schemas-microsoft-com:office" in head or b"<Workbook" in head
        ):
            return XlsFormat.XML2003
        return XlsFormat.HTML

    return XlsFormat.UNKNOWN


def hex_preview(path: Path, n_bytes: int = 32) -> str:
    """Primeros N bytes en hex + ASCII (debug)."""
    with path.open("rb") as f:
        data = f.read(n_bytes)
    hex_part = " ".join(f"{b:02X}" for b in data)
    ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
    return f"{hex_part}\n  {ascii_part}"
