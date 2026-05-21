"""XlsReader — interfaz unificada para leer .xls SBS sin importar el formato real.

Devuelve filas/celdas como tipos Python comunes (str | int | float | None).
Resuelve internamente si usar xlrd (BIFF) o openpyxl (OOXML).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from aibenchef_data.domains.shared import ValidationError

from ..value_objects.xls_format import XlsFormat, detect_xls_format

Cell = str | int | float | bool | None


@dataclass(frozen=True, slots=True)
class XlsSheet:
    name: str
    n_rows: int
    n_cols: int
    rows: list[list[Cell]]

    def row(self, idx: int) -> list[Cell]:
        return self.rows[idx]

    def cell(self, r: int, c: int) -> Cell:
        if r >= self.n_rows or c >= len(self.rows[r]):
            return None
        return self.rows[r][c]


class XlsReader(Protocol):
    def read(self, path: Path) -> list[XlsSheet]: ...


def read_xls(path: Path) -> list[XlsSheet]:
    """Lee cualquier .xls SBS (autodetecta BIFF vs OOXML)."""
    if not path.exists():
        raise ValidationError(f"Archivo no existe: {path}")
    fmt = detect_xls_format(path)
    if fmt == XlsFormat.BIFF:
        return _read_biff(path)
    if fmt == XlsFormat.OOXML:
        return _read_ooxml(path)
    raise ValidationError(
        f"Formato desconocido para {path.name}", context={"format": fmt.value}
    )


def _read_biff(path: Path) -> list[XlsSheet]:
    import xlrd

    book = xlrd.open_workbook(str(path), formatting_info=False)
    sheets: list[XlsSheet] = []
    for sheet in book.sheets():
        rows: list[list[Cell]] = []
        for r in range(sheet.nrows):
            row_cells: list[Cell] = []
            for c in range(sheet.ncols):
                row_cells.append(_normalize_xlrd_cell(sheet, r, c))
            rows.append(row_cells)
        sheets.append(
            XlsSheet(name=sheet.name, n_rows=sheet.nrows, n_cols=sheet.ncols, rows=rows)
        )
    return sheets


def _normalize_xlrd_cell(sheet: Any, r: int, c: int) -> Cell:
    import xlrd

    t = sheet.cell_type(r, c)
    v = sheet.cell_value(r, c)
    if t == xlrd.XL_CELL_EMPTY or t == xlrd.XL_CELL_BLANK:
        return None
    if t == xlrd.XL_CELL_TEXT:
        s = str(v).strip()
        return s or None
    if t == xlrd.XL_CELL_NUMBER:
        return v
    if t == xlrd.XL_CELL_BOOLEAN:
        return bool(v)
    if t == xlrd.XL_CELL_ERROR:
        return None
    return v


def _read_ooxml(path: Path) -> list[XlsSheet]:
    from openpyxl import load_workbook

    wb = load_workbook(filename=str(path), read_only=True, data_only=True)
    sheets: list[XlsSheet] = []
    for ws in wb.worksheets:
        rows: list[list[Cell]] = []
        max_cols = 0
        for row in ws.iter_rows(values_only=True):
            row_cells: list[Cell] = []
            for v in row:
                if v is None or (isinstance(v, str) and not v.strip()):
                    row_cells.append(None)
                elif isinstance(v, str):
                    row_cells.append(v.strip())
                else:
                    row_cells.append(v)
            rows.append(row_cells)
            max_cols = max(max_cols, len(row_cells))
        sheets.append(
            XlsSheet(name=ws.title, n_rows=len(rows), n_cols=max_cols, rows=rows)
        )
    wb.close()
    return sheets
