"""XlsInspector — utilidad para inspeccionar la estructura de un .xls SBS.

Soporta tanto BIFF (.xls binario clasico) como OOXML (.xlsx camuflado con
extension .xls que publica SBS para algunos topicos).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..value_objects.xls_format import detect_xls_format, hex_preview
from .xls_reader import XlsSheet, read_xls


@dataclass(frozen=True, slots=True)
class XlsSheetInfo:
    name: str
    n_rows: int
    n_cols: int


class XlsInspector:
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
        if not xls_path.exists():
            return f"[ERROR] No existe: {xls_path}"

        fmt = detect_xls_format(xls_path)

        try:
            sheets = read_xls(xls_path)
        except Exception as e:
            # Cuando falla, mostrar magic bytes para diagnostico
            return (
                f"# {xls_path.name}\n"
                f"  path:   {xls_path}\n"
                f"  size:   {xls_path.stat().st_size:,} bytes\n"
                f"  format: {fmt.value}\n"
                f"  [ERROR] {e}\n"
                f"  hex preview (first 32 bytes):\n"
                f"  {hex_preview(xls_path)}"
            )

        out: list[str] = []
        out.append(f"# {xls_path.name}")
        out.append(f"  path:   {xls_path}")
        out.append(f"  size:   {xls_path.stat().st_size:,} bytes")
        out.append(f"  format: {fmt.value}")
        out.append(f"  sheets: {len(sheets)}")
        out.append("")

        for idx, sheet in enumerate(sheets):
            out.append(
                f"## Sheet [{idx}] '{sheet.name}'  rows={sheet.n_rows}  cols={sheet.n_cols}"
            )
            out.append(self._render_preview(sheet))
            out.append("")

        return "\n".join(out)

    def _render_preview(self, sheet: XlsSheet) -> str:
        rows = min(sheet.n_rows, self._max_preview_rows)
        cols = min(sheet.n_cols, self._max_preview_cols)
        lines: list[str] = []

        header = "      " + " | ".join(
            f"col{c:02d}".center(self._cell_width) for c in range(cols)
        )
        lines.append(header)
        lines.append("      " + "-" * (len(header) - 6))

        for r in range(rows):
            cells: list[str] = []
            for c in range(cols):
                v = sheet.cell(r, c)
                if v is None:
                    s = ""
                elif isinstance(v, float):
                    s = f"{v:,.2f}" if v != int(v) else f"{int(v):,}"
                elif isinstance(v, int):
                    s = f"{v:,}"
                else:
                    s = str(v).strip()
                if len(s) > self._cell_width:
                    s = s[: self._cell_width - 1] + "…"
                cells.append(s.ljust(self._cell_width))
            lines.append(f"r{r:03d}  " + " | ".join(cells))

        if sheet.n_rows > self._max_preview_rows:
            lines.append(
                f"      ... ({sheet.n_rows - self._max_preview_rows} filas mas, "
                f"{sheet.n_cols - cols if sheet.n_cols > cols else 0} cols mas)"
            )

        return "\n".join(lines)
