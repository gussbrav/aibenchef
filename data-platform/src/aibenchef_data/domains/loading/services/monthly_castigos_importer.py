"""MonthlyCastigosImporter — carga los .xls mensuales SBS de tópico
castigos a raw.castigos_observacion.

El archivo tiene flujo MENSUAL de castigos (no acumulado), layout
horizontal en todos los grupos:
    R1: titulo "Flujo de Creditos Castigados por Tipo..."
    R2: "en el mes de <MES> de <AÑO>"
    R3: "(En miles de soles)"
    R5: header "Empresas | Flujo de castigos | ... | Total"
    R6: sub-header productos (Corporativos | Grandes | Medianas | Pequenas |
        Microempresas | Consumo | Hipotecarios)
    R7+: data, col 0 = empresa, cols 2-8 = montos por producto, col 9 = total
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


_PRODUCTOS_PATRONES: list[tuple[str, list[str]]] = [
    ("Corporativo",       ["corporativ"]),
    ("Grandes Empresas",  ["grandes"]),
    ("Medianas Empresas", ["mediana"]),
    ("Pequeña Empresa",   ["peque"]),
    ("Microempresa",      ["micro"]),
    ("Consumo",           ["consumo"]),
    ("Hipotecario",       ["hipotec"]),
]


_MESES_ES = {
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
    'julio': 7, 'agosto': 8, 'setiembre': 9, 'septiembre': 9,
    'octubre': 10, 'noviembre': 11, 'diciembre': 12,
}


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _safe_text(v):
    if v is None: return None
    s = str(v).strip()
    return s if s else None


def _to_num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip()
    if not s or s == '-': return None
    try: return float(s.replace(",", ""))
    except (ValueError, TypeError): return None


def _excel_serial_to_date(serial: float):
    try:
        dt = datetime(1899, 12, 30) + timedelta(days=float(serial))
        if 2000 <= dt.year <= 2050:
            return dt
    except (ValueError, OverflowError):
        pass
    return None


def _extract_fecha(sheet) -> tuple[int, str] | None:
    """Castigos suele decir 'en el mes de Diciembre de 2024'."""
    for r in range(0, 6):
        for c in range(0, 3):
            v = sheet.cell(r, c)
            if v is None:
                continue
            if hasattr(v, "year") and hasattr(v, "month"):
                a, m = int(v.year), int(v.month)
                if 2000 <= a <= 2050:
                    return (a * 100 + m, f"{a:04d}-{m:02d}-01")
            if isinstance(v, (int, float)) and 30000 <= float(v) <= 60000:
                dt = _excel_serial_to_date(float(v))
                if dt:
                    return (dt.year * 100 + dt.month, dt.strftime("%Y-%m-%d"))
            s = str(v).strip()
            m = re.search(
                r"(\d{1,2})?\s*(?:de\s+)?([A-Za-záéíóúÑñ]+)\s+(?:de\s+)?(\d{4})",
                _strip_accents(s).lower(),
            )
            if m:
                mes_str = m.group(2)
                anio = int(m.group(3))
                mes = _MESES_ES.get(mes_str)
                if mes and 2000 <= anio <= 2050:
                    return (anio * 100 + mes, f"{anio:04d}-{mes:02d}-01")
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
            if m:
                a, mes_n, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 2000 <= a <= 2050:
                    return (a * 100 + mes_n, f"{a:04d}-{mes_n:02d}-{d:02d}")
    return None


def _detect_tipo_entidad(path: Path) -> str:
    for part in path.parts:
        n = part.lower()
        if n in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[n]
    return "DESCONOCIDO"


def _producto_canonico(raw: str) -> str | None:
    if not raw: return None
    s = _strip_accents(raw).lower().strip()
    for canon, pats in _PRODUCTOS_PATRONES:
        if any(p in s for p in pats):
            return canon
    return None


class MonthlyCastigosImporter:
    """Importer de .xls SBS mensuales de castigos. Flujo del mes por producto."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_castigos.start", path=str(path))

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

        # Detectar producto -> columna (header sub-row contiene productos)
        header_row = None
        for r in range(0, 10):
            v = _safe_text(sheet.cell(r, 0))
            if v and _strip_accents(v).lower().strip() in ("empresa", "empresas", "empresas*"):
                header_row = r
                break
        if header_row is None:
            raise ValidationError(f"No pude detectar header en {path}")

        # Mapear cada columna >=1 a su producto
        producto_cols: list[tuple[str, int]] = []
        sub_header_row = header_row + 1
        for c in range(1, sheet.n_cols):
            v = _safe_text(sheet.cell(sub_header_row, c))
            if v:
                canon = _producto_canonico(v)
                if canon:
                    producto_cols.append((canon, c))
        if not producto_cols:
            raise ValidationError(f"No detecte productos en {path}")

        tipo_entidad = _detect_tipo_entidad(path)
        data_start = sub_header_row + 1

        rows: list[tuple] = []
        for r in range(data_start, sheet.n_rows):
            emp = _safe_text(sheet.cell(r, 0))
            if not emp:
                continue
            emp_low = _strip_accents(emp).lower()
            if (emp_low.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                or len(emp) < 3):
                continue
            for canon, c in producto_cols:
                v = _to_num(sheet.cell(r, c))
                if v is None or v <= 0:
                    continue
                rows.append((
                    periodo, fecha_iso, emp, emp,  # entidad, entidad_final (same en monthly)
                    tipo_entidad, canon, v,
                    "monthly_castigos", path.name,
                ))

        if not rows:
            return ImportResult(
                source="monthly_castigos", source_file=path.name,
                rows_inserted=0, rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas",),
            )

        # Dedup mismo grupo
        async with self._conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM raw.castigos_observacion "
                "WHERE periodo=%s AND tipo_entidad=%s AND source='monthly_castigos'",
                (periodo, tipo_entidad),
            )

        insert_sql = """
            INSERT INTO raw.castigos_observacion (
                periodo, fecha_cierre, entidad, entidad_final, tipo_entidad,
                producto, saldo_castigos, source, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        inserted = 0
        for i in range(0, len(rows), self._batch_size):
            batch = rows[i : i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(insert_sql, batch)
            await self._conn.commit()
            inserted += len(batch)

        log.info("monthly_castigos.done", inserted=inserted, periodo=periodo)
        return ImportResult(
            source="monthly_castigos", source_file=path.name,
            rows_inserted=inserted, rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )
