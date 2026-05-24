"""MonthlyPersonalImporter — carga los .xls mensuales SBS de tópico 09
(PERSONAL_SBS) a raw.personal_observacion.

Formato del .xls SBS:

    R0-R1: titulo "Personal según Categoría Laboral por Empresa"
    R2:    fecha (Excel serial) o fecha string
    R3:    "(En número de personas)"
    R4:    vacio
    R5:    header "Empresas | Gerentes | Funcionarios | Empleados | Otros | Total"
    R6:    vacio
    R7+:   data. Columna A = nombre (truncado en BANCOS, completo en CMAC/CRAC/EDPYME)
           Columna B-E = headcount por categoria
           Columna F = Total

Codigos SBS por grupo (topico 09):
- BANCOS:     B-2305
- FINANCIERAS: B-3105
- CMAC:       C-1205
- CRAC:       C-2205
- EDPYME:     C-4205
"""

from __future__ import annotations

import re
import time
import unicodedata
from pathlib import Path

import psycopg

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)


_TIPO_ENTIDAD_BY_FOLDER = {
    "banca_multiple": "BANCOS",
    "01_entidad_banca_multiple": "BANCOS",
    "financiera": "FINANCIERAS",
    "02_entidad_empresas_financiera": "FINANCIERAS",
    "cmac": "CMAC",
    "03_entidad_cajamunicipales": "CMAC",
    "crac": "CRAC",
    "04_entidad_cajarurales": "CRAC",
    "edpyme": "EDPYMES",
    "05_entidad_edpymes": "EDPYMES",
}


def _safe_text(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _to_int(v) -> int | None:
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return int(v)
        s = str(v).strip()
        if not s:
            return None
        return int(float(s.replace(",", "")))
    except (ValueError, TypeError):
        return None


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _excel_serial_to_date(serial: float) -> tuple[int, int, int] | None:
    if serial is None or serial <= 0:
        return None
    try:
        from datetime import datetime, timedelta
        epoch = datetime(1899, 12, 30)
        dt = epoch + timedelta(days=float(serial))
        if 2000 <= dt.year <= 2050:
            return (dt.year, dt.month, dt.day)
    except (ValueError, OverflowError):
        pass
    return None


def _extract_fecha_cierre(sheet) -> tuple[int, str] | None:
    """Busca la fecha en las primeras 6 filas. Soporta 4 formatos."""
    for r in range(0, 6):
        for c in range(0, 3):
            v = sheet.cell(r, c)
            if v is None:
                continue
            if hasattr(v, "year") and hasattr(v, "month"):
                anio, mes = int(v.year), int(v.month)
                if 2000 <= anio <= 2050 and 1 <= mes <= 12:
                    return (anio * 100 + mes, f"{anio:04d}-{mes:02d}-{v.day:02d}")
            if isinstance(v, (int, float)) and 30000 <= float(v) <= 60000:
                fecha = _excel_serial_to_date(float(v))
                if fecha:
                    a, m, d = fecha
                    return (a * 100 + m, f"{a:04d}-{m:02d}-{d:02d}")
            s = str(v).strip()
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
            if m:
                a, mes_n, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 2000 <= a <= 2050 and 1 <= mes_n <= 12:
                    return (a * 100 + mes_n, f"{a:04d}-{mes_n:02d}-{d:02d}")
            m = re.match(r"^\s*(\d{5})(?:\.\d+)?\s*$", s)
            if m:
                fecha = _excel_serial_to_date(float(m.group(1)))
                if fecha:
                    a, mes_n, d = fecha
                    return (a * 100 + mes_n, f"{a:04d}-{mes_n:02d}-{d:02d}")
    return None


def _detect_layout(sheet) -> dict[str, int] | None:
    """Detecta header_row y columnas (Empresas, Gerentes, Funcionarios, Empleados, Otros, Total)."""
    layout: dict[str, int] = {}
    header_row = None

    # Buscar "Empresa" o "Empresas" en columna 0 de las primeras 12 filas
    for r in range(0, 12):
        v = sheet.cell(r, 0)
        if v is None:
            continue
        s = _strip_accents(str(v)).lower().strip()
        if s in ("empresa", "empresas"):
            header_row = r
            break
    if header_row is None:
        return None

    # En esa fila, mapear columnas
    for c in range(0, sheet.n_cols):
        v = sheet.cell(header_row, c)
        if v is None:
            continue
        s = _strip_accents(str(v)).lower().strip()
        if s in ("empresa", "empresas"):
            layout["empresa"] = c
        elif s.startswith("gerente"):
            layout["gerentes"] = c
        elif s.startswith("funcionario"):
            layout["funcionarios"] = c
        elif s.startswith("empleado"):
            layout["empleados"] = c
        elif s == "otros":
            layout["otros"] = c
        elif s.startswith("total"):
            layout["total"] = c

    layout["_header_row"] = header_row
    layout["_data_start_row"] = header_row + 1

    if "empresa" not in layout or "total" not in layout:
        return None
    return layout


def _detect_tipo_entidad(path: Path) -> str:
    for part in path.parts:
        norm = part.lower()
        if norm in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[norm]
    name = path.name.upper()
    if name.startswith("B-23") or name.startswith("B-2305"):
        return "BANCOS"
    if name.startswith("B-31"):
        return "FINANCIERAS"
    if name.startswith("C-12"):
        return "CMAC"
    if name.startswith("C-22"):
        return "CRAC"
    if name.startswith("C-42"):
        return "EDPYMES"
    return "DESCONOCIDO"


class MonthlyPersonalImporter:
    """Importer de .xls mensuales SBS topico 09 — uno por (grupo, periodo)."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_personal.start", path=str(path))

        try:
            sheets = read_xls(path)
        except Exception as e:
            raise ValidationError(f"No pude leer {path}: {e}") from e
        if not sheets:
            raise ValidationError(f"Sin hojas en {path}")
        sheet = sheets[0]

        fecha_info = _extract_fecha_cierre(sheet)
        if fecha_info is None:
            raise ValidationError(f"No pude extraer fecha de {path}")
        periodo, fecha_iso = fecha_info

        layout = _detect_layout(sheet)
        if layout is None:
            raise ValidationError(f"No pude detectar layout en {path}")

        tipo_entidad = _detect_tipo_entidad(path)
        data_start = int(layout["_data_start_row"])
        c_emp = layout["empresa"]
        c_ger = layout.get("gerentes")
        c_fun = layout.get("funcionarios")
        c_emp_cat = layout.get("empleados")
        c_otr = layout.get("otros")
        c_tot = layout["total"]

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for r in range(data_start, sheet.n_rows):
            try:
                emp = _safe_text(sheet.cell(r, c_emp))
                if not emp:
                    skipped += 1
                    continue
                emp_lower = emp.lower()
                if (
                    emp_lower.startswith("total")
                    or emp_lower.startswith("nota")
                    or emp_lower.startswith("fuente")
                    or emp_lower.startswith("elaborac")
                    or emp_lower.startswith("(")
                    or len(emp) < 3
                ):
                    skipped += 1
                    continue

                total = _to_int(sheet.cell(r, c_tot))
                if total is None:
                    skipped += 1
                    continue

                gerentes = _to_int(sheet.cell(r, c_ger)) if c_ger is not None else None
                funcionarios = _to_int(sheet.cell(r, c_fun)) if c_fun is not None else None
                empleados = _to_int(sheet.cell(r, c_emp_cat)) if c_emp_cat is not None else None
                otros = _to_int(sheet.cell(r, c_otr)) if c_otr is not None else None

                rows.append((
                    periodo, fecha_iso,
                    emp, None, tipo_entidad, None, None, None,
                    gerentes, funcionarios, empleados, otros, total,
                    path.name,
                ))
            except Exception as e:
                errors.append(f"row {r}: {e}")
                if len(errors) > 30:
                    break

        log.info("monthly_personal.parsed", rows=len(rows), skipped=skipped, periodo=periodo)

        if not rows:
            return ImportResult(
                source="monthly_personal",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        insert_sql = """
            INSERT INTO raw.personal_observacion (
                periodo, fecha_cierre, empresa_sbs, empresa_bd, tipo_entidad,
                microfinanciera, nacional, mayor_50_pct_mype,
                gerentes, funcionarios, empleados, otros, total, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa_sbs) DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                gerentes = EXCLUDED.gerentes,
                funcionarios = EXCLUDED.funcionarios,
                empleados = EXCLUDED.empleados,
                otros = EXCLUDED.otros,
                total = EXCLUDED.total,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        for i in range(0, len(rows), self._batch_size):
            batch = rows[i : i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(insert_sql, batch)
            await self._conn.commit()
            inserted += len(batch)

        log.info(
            "monthly_personal.done",
            inserted=inserted,
            skipped=skipped,
            periodo=periodo,
            duration_s=round(time.perf_counter() - start, 2),
        )

        return ImportResult(
            source="monthly_personal",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
