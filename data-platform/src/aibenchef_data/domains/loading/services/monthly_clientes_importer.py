"""MonthlyClientesImporter — carga los .xls mensuales SBS de tópico 05
(CLIENTES_CREDITO_SBS) a raw.clientes_creditos.

Formato del .xls SBS — tiene VARIANTES por grupo:

BANCOS (B-230803, sheet "56"):
    R0-R1: titulo + decoracion
    R2: fecha (Excel serial)
    R3: numeros de tipo (3,4,6,8,7,2,5) — encabezado de orden
    R4: "Corporativo | Grandes empresas | Medianas empresas | ..."
    R5: vacio
    R6: header con nombres de columnas
         "Empresas | Deudores Corporativos | ... | Total de deudores 2/"
    R7-R8: subheader vacios
    R9+: data. Columna A = nombre truncado ("B. BBVA Per�", "B. de Cr�dito del Per� (c")
         Columna I = Total de deudores

CMAC/CRAC/EDPYME/FINANCIERAS (C-* / B-3218, sheet "NumDeud(CM)" o similar):
    R0: titulo
    R1: fecha (Excel serial)
    R2: vacio
    R3: header "Empresas | Deudores Corporativos | ... | Total2/"
    R4: vacio
    R5+: data. Columna A = nombre LIMPIO ("CMAC Arequipa", "CMAC Cusco")
         Columna I = Total2/

Comportamiento:
- Detecta header row buscando "Empresa" / "Empresas" en primeras 12 filas
- Detecta columna "Total" en el header (matching fuzzy)
- Inserta UNA fila por entidad con producto='TOTAL' y n_clientes = total
- tipo_entidad detectado del path padre
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


# Mapeo de strings de productos a forma canonica
_PRODUCTOS_PATRONES = [
    ("Corporativo",       ["corporativ"]),
    ("Grandes Empresas",  ["grandes"]),
    ("Medianas Empresas", ["mediana"]),
    ("Pequeña Empresa",   ["peque"]),
    ("Microempresa",      ["micro", "mes"]),
    ("Consumo",           ["consumo"]),
    ("Hipotecario",       ["hipotec"]),
    ("Comerciales",       ["comercial"]),
]


def _producto_canonico(raw: str) -> str | None:
    if not raw:
        return None
    s = _strip_accents(raw).lower().strip()
    for canon, pats in _PRODUCTOS_PATRONES:
        if any(p in s for p in pats):
            return canon
    return None


def _detect_layout(sheet) -> dict | None:
    """Detecta header_row, col_empresas, col_total, productos por columna."""
    layout: dict = {}
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
    productos_cols: list[tuple[str, int]] = []
    for c in range(0, sheet.n_cols):
        v = sheet.cell(header_row, c)
        if v is None:
            continue
        s_raw = str(v)
        s = _strip_accents(s_raw).lower().strip()
        # Columna de nombre de entidad
        if s in ("empresa", "empresas"):
            layout["empresa"] = c
        # Columna Total
        elif s.startswith("total") or "total de deudores" in s or "total2" in s:
            layout["total"] = c
        else:
            # Intentar matchear producto
            canon = _producto_canonico(s_raw)
            if canon and not any(c == col for _, col in productos_cols):
                productos_cols.append((canon, c))

    layout["productos"] = productos_cols
    layout["_header_row"] = header_row
    layout["_data_start_row"] = header_row + 1

    return layout if "empresa" in layout and "total" in layout else None


def _detect_tipo_entidad(path: Path) -> str:
    for part in path.parts:
        norm = part.lower()
        if norm in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[norm]
    name = path.name.upper()
    if name.startswith("B-"):
        return "BANCOS"
    if name.startswith("C-"):
        return "CMAC"
    return "DESCONOCIDO"


class MonthlyClientesImporter:
    """Importer de .xls mensuales SBS topico 05 — uno por (grupo, periodo)."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_clientes.start", path=str(path))

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
        c_tot = layout["total"]
        productos_cols = layout.get("productos", [])

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for r in range(data_start, sheet.n_rows):
            try:
                emp = _safe_text(sheet.cell(r, c_emp))
                if not emp:
                    skipped += 1
                    continue
                # Skip filas de totales/notas
                emp_lower = emp.lower()
                if (
                    emp_lower.startswith("total")
                    or emp_lower.startswith("nota")
                    or emp_lower.startswith("fuente")
                    or emp_lower.startswith("elaborac")
                    or emp_lower.startswith("(")  # "(p) Provisional", etc
                    or len(emp) < 3
                ):
                    skipped += 1
                    continue

                total = _to_int(sheet.cell(r, c_tot))
                if total is None:
                    skipped += 1
                    continue

                # Fila TOTAL (agregado)
                rows.append((
                    periodo, fecha_iso,
                    emp, None, tipo_entidad, None, None,
                    "TOTAL", total,
                    path.name,
                ))

                # Filas por cada producto canonico detectado en header
                for canon, col in productos_cols:
                    n = _to_int(sheet.cell(r, col))
                    if n is None or n <= 0:
                        continue
                    rows.append((
                        periodo, fecha_iso,
                        emp, None, tipo_entidad, None, None,
                        canon, n,
                        path.name,
                    ))
            except Exception as e:
                errors.append(f"row {r}: {e}")
                if len(errors) > 30:
                    break

        log.info("monthly_clientes.parsed", rows=len(rows), skipped=skipped, periodo=periodo)

        if not rows:
            return ImportResult(
                source="monthly_clientes_creditos",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        insert_sql = """
            INSERT INTO raw.clientes_creditos (
                periodo, fecha_cierre, empresa, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_cb,
                producto, n_clientes, source, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'monthly_clientes_creditos',%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion)
            DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                n_clientes = EXCLUDED.n_clientes,
                source = EXCLUDED.source,
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
            "monthly_clientes.done",
            inserted=inserted,
            skipped=skipped,
            periodo=periodo,
            duration_s=round(time.perf_counter() - start, 2),
        )

        return ImportResult(
            source="monthly_clientes_creditos",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
