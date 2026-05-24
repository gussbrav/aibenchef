"""MonthlyDepositosImporter — carga los .xls mensuales SBS de tópico
depositos a raw.depositos_observacion.

Layout horizontal en TODOS los grupos (BANCA, FINANCIERA, CMAC, CRAC):
    R0/R1:   titulo + fecha (serial o ISO)
    R4 o R5: header con "Empresas" en col 0 + tipos de deposito
             (Ahorros / Plazo / CTS / Vista) en cols variables
    R5/R6:   sub-header (Personas Naturales / Jurídicas sin fines / Otras)
    R7+:     data, col 0 = empresa, cols 1+ = montos por sub-categoría.

Para % participacion SMF lo único que necesitamos es saldo_total por
entidad. Por eso este importer SUMA todas las columnas numericas (>0)
de cada fila y guarda una sola fila por (periodo, empresa) con
producto='TOTAL'.
"""

from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

import psycopg

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)


_TIPO_ENTIDAD_BY_FOLDER = {
    "banca_multiple": "BANCOS",
    "financiera": "FINANCIERAS",
    "cmac": "CMAC",
    "crac": "CRAC",
    "edpyme": "EDPYMES",
}


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _safe_text(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _excel_serial_to_date(serial: float):
    try:
        dt = datetime(1899, 12, 30) + timedelta(days=float(serial))
        if 2000 <= dt.year <= 2050:
            return dt
    except (ValueError, OverflowError):
        pass
    return None


def _extract_fecha(sheet) -> tuple[int, str] | None:
    for r in range(0, 6):
        for c in range(0, 3):
            v = sheet.cell(r, c)
            if v is None:
                continue
            if hasattr(v, "year") and hasattr(v, "month"):
                a, m = int(v.year), int(v.month)
                if 2000 <= a <= 2050 and 1 <= m <= 12:
                    return (a * 100 + m, f"{a:04d}-{m:02d}-{v.day:02d}")
            if isinstance(v, (int, float)) and 30000 <= float(v) <= 60000:
                dt = _excel_serial_to_date(float(v))
                if dt:
                    return (dt.year * 100 + dt.month, dt.strftime("%Y-%m-%d"))
            s = str(v).strip()
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
            if m:
                a, mes_n, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 2000 <= a <= 2050 and 1 <= mes_n <= 12:
                    return (a * 100 + mes_n, f"{a:04d}-{mes_n:02d}-{d:02d}")
            m = re.match(r"^\s*(\d{5})(?:\.\d+)?\s*$", s)
            if m:
                dt = _excel_serial_to_date(float(m.group(1)))
                if dt:
                    return (dt.year * 100 + dt.month, dt.strftime("%Y-%m-%d"))
    return None


def _detect_tipo_entidad(path: Path) -> str:
    for part in path.parts:
        n = part.lower()
        if n in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[n]
    return "DESCONOCIDO"


def _find_header_row(sheet) -> int | None:
    """Busca fila donde col 0 sea 'Empresas' (header de entidades)."""
    for r in range(0, 10):
        v = _safe_text(sheet.cell(r, 0))
        if v and _strip_accents(v).lower().strip() in ("empresa", "empresas", "empresas*"):
            return r
    return None


class MonthlyDepositosImporter:
    """Importer de .xls SBS mensuales de depositos. Una fila por entidad."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_dep.start", path=str(path))

        try:
            sheets = read_xls(path)
        except Exception as e:
            raise ValidationError(f"No pude leer {path}: {e}") from e
        if not sheets:
            raise ValidationError(f"Sin hojas en {path}")
        sheet = sheets[0]

        fecha = _extract_fecha(sheet)
        if not fecha:
            raise ValidationError(f"No pude extraer fecha de {path}")
        periodo, fecha_iso = fecha

        header_row = _find_header_row(sheet)
        if header_row is None:
            raise ValidationError(f"No pude detectar header en {path}")

        tipo_entidad = _detect_tipo_entidad(path)
        # Data empieza 2-3 filas despues del header (entre medio hay sub-header)
        data_start = header_row + 2

        # Suma TODAS las cols numericas (>= col 1) por fila
        rows: list[tuple] = []
        for r in range(data_start, sheet.n_rows):
            emp = _safe_text(sheet.cell(r, 0))
            if not emp:
                continue
            emp_low = _strip_accents(emp).lower()
            if (emp_low.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                or len(emp) < 3):
                continue
            saldo_total = 0.0
            valid = False
            for c in range(1, sheet.n_cols):
                v = sheet.cell(r, c)
                if isinstance(v, (int, float)):
                    saldo_total += float(v)
                    valid = True
                else:
                    try:
                        f = float(str(v).replace(",", "").strip())
                        saldo_total += f
                        valid = True
                    except (ValueError, TypeError, AttributeError):
                        pass
            if not valid or saldo_total <= 0:
                continue
            rows.append((
                periodo, fecha_iso, emp, tipo_entidad,
                "TOTAL",  # producto = TOTAL (consolida los 4 tipos de deposito)
                saldo_total,
                "monthly_depositos", path.name,
            ))

        if not rows:
            return ImportResult(
                source="monthly_depositos", source_file=path.name,
                rows_inserted=0, rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas extraidas",),
            )

        # Limpiar filas previas del MISMO archivo (no del periodo completo) para
        # permitir re-imports idempotentes sin pisar otros grupos.
        async with self._conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM raw.depositos_observacion "
                "WHERE periodo=%s AND tipo_entidad=%s AND source='monthly_depositos'",
                (periodo, tipo_entidad),
            )

        insert_sql = """
            INSERT INTO raw.depositos_observacion (
                periodo, fecha_cierre, empresa, tipo_entidad, producto, saldo_total,
                source, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """
        inserted = 0
        for i in range(0, len(rows), self._batch_size):
            batch = rows[i : i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(insert_sql, batch)
            await self._conn.commit()
            inserted += len(batch)

        log.info("monthly_dep.done", inserted=inserted, periodo=periodo,
                 duration_s=round(time.perf_counter() - start, 2))

        return ImportResult(
            source="monthly_depositos", source_file=path.name,
            rows_inserted=inserted, rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )
