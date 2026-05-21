"""Domain parsing — convertir .xls SBS en filas tipadas."""

from .services.xls_inspector import XlsInspector, XlsSheetInfo

__all__ = ["XlsInspector", "XlsSheetInfo"]
