"""Domain parsing — convertir .xls SBS en filas tipadas."""

from .services.xls_inspector import XlsInspector, XlsSheetInfo
from .services.xls_reader import XlsSheet, read_xls
from .value_objects.xls_format import XlsFormat, detect_xls_format

__all__ = [
    "XlsInspector",
    "XlsSheetInfo",
    "XlsSheet",
    "read_xls",
    "XlsFormat",
    "detect_xls_format",
]
