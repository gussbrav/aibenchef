"""XlsInspector — utilidad para inspeccionar la estructura de un .xls SBS.

Sirve para reverse-engineer el layout antes de codear un parser concreto.
Muestra: hojas, dimensiones, primeras filas (con merged cells normalizadas).

Uso:
    from pathlib import Path
    XlsInspector().inspect(Path("./local-data/raw/banca_multiple/eeff/2024/12/B-2201-di2024.xls"))
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import xlrd


@dataclass(frozen=True, slots=True)
class XlsSheetInfo:
    name: str
    n_rows: int
    n_cols: int
    merged_cells: int


class XlsInspector:
    """Lee la estructura de un .xls binario (formato Excel 97-2003 que usa SBS)."""

    def __init__(
        self,
        *,
        max_preview_rows: int = 20,
        max_preview_cols: int = 12,
        cell_width: int = 18,
    ) -> None:
        self._max_preview_rows = max_preview_rows
        self._max_preview_cols = max_preview_cols
        self._cell_width = cell_width

    def inspect(self, xls_path: Path) -> str:
        """Devuelve un reporte texto de la estructura del .xls."""
        if not xls_path.exists():
            return f"[ERROR] No existe: {xls_path}"

        try:
            book = xlrd.open_workbook(str(xls_path), formatting_info=False)
        except Exception as e:
            return f"[ERROR] No se pudo abrir {xls_path}: {e}"

        out: list[str] = []
        out.append(f"# {xls_path.name}")
        out.append(f"  path: {xls_path}")
        out.append(f"  size: {xls_path.stat().st_size:,} bytes")
        out.append(f"  sheets: {book.nsheets}")
        out.append("")

        for idx, sheet in enumerate(book.sheets()):
            info = XlsSheetInfo(
                name=sheet.name,
                n_rows=sheet.nrows,
                n_cols=sheet.ncols,
                merged_cells=len(sheet.merged_cells),
            )
            out.append(f"## Sheet [{idx}] '{info.name}'")
            out.append(
                f"  rows={info.n_rows}  cols={info.n_cols}  merged_cells={info.merged_cells}"
            )
            out.append(self._render_preview(sheet))
            out.append("")

        return "\n".join(out)

    def _render_preview(self, sheet: "xlrd.sheet.Sheet") -> str:  # type: ignore[name-defined]
        rows = min(sheet.nrows, self._max_preview_rows)
        cols = min(sheet.ncols, self._max_preview_cols)
        lines: list[str] = []

        # Header con indices de columna
        header = "      " + " | ".join(
            f"col{c:02d}".center(self._cell_width) for c in range(cols)
        )
        lines.append(header)
        lines.append("      " + "-" * (len(header) - 6))

        for r in range(rows):
            cells = []
            for c in range(cols):
                v = sheet.cell_value(r, c)
                cell_type = sheet.cell_type(r, c)
                if cell_type == xlrd.XL_CELL_NUMBER:
                    s = f"{v:.2f}" if v != int(v) else str(int(v))
                else:
                    s = str(v).strip()
                if len(s) > self._cell_width:
                    s = s[: self._cell_width - 1] + "…"
                cells.append(s.ljust(self._cell_width))
            lines.append(f"r{r:03d}  " + " | ".join(cells))

        if sheet.nrows > self._max_preview_rows:
            lines.append(
                f"      ... ({sheet.nrows - self._max_preview_rows} filas mas, "
                f"{sheet.ncols - cols if sheet.ncols > cols else 0} cols mas)"
            )

        return "\n".join(lines)
