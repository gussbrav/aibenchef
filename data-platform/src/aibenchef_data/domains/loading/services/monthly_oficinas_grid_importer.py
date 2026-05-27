"""MonthlyOficinasGridImporter — carga los .xls mensuales SBS del topico
oficinas (B-2303 / B-3201 / C-1201 / C-2201 / C-4205) a raw.oficinas_observacion.

Layout SBS (grid simple empresa x departamento):
- R0 o R1, col 0: titulo "Distribucion de Oficinas..."
- R1 o R2, col 0: fecha (serial Excel o ISO string)
- R3 o R5, col 0: "Empresas" (header)
- R3 o R5, col 1+: nombres de departamentos (Amazonas, Ancash, Apurimac, ...,
  Lima Metropolitana, ..., Total)
- R+: una fila por empresa con # oficinas por departamento

NOTA: NO confundir con MonthlyOficinasImporter (que procesa creditos_depositos_geo,
otro topico SBS con codigo distinto).

Output a raw.oficinas_observacion (long-format):
- 1 fila por (periodo, tipo_entidad, empresa, departamento)
- Idempotente via ON CONFLICT
"""

from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

import psycopg

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.parsing.services.xls_reader import XlsSheet
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

_MESES_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}  # fmt: skip

_MES_ABREV_SBS = {
    "en": 1, "fe": 2, "ma": 3, "ab": 4, "my": 5, "jn": 6,
    "jl": 7, "ag": 8, "se": 9, "oc": 10, "no": 11, "di": 12,
}  # fmt: skip


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _safe_text(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _to_int(v) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace(",", "")
    if not s or s == "-":
        return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def _excel_serial_to_date(serial: float):
    try:
        dt = datetime(1899, 12, 30) + timedelta(days=float(serial))
        if 2000 <= dt.year <= 2050:
            return dt
    except (ValueError, OverflowError):
        pass
    return None


def _extract_fecha(sheet: XlsSheet) -> tuple[int, str] | None:
    """Busca fecha en filas 0-5, cols 0-2. Soporta datetime, serial, ISO, español."""
    for r in range(0, 6):
        for c in range(0, 3):
            v = sheet.cell(r, c)
            if v is None:
                continue
            if hasattr(v, "year") and hasattr(v, "month"):
                a, m = int(v.year), int(v.month)
                if 2000 <= a <= 2050:
                    return (a * 100 + m, f"{a:04d}-{m:02d}-{v.day:02d}")
            if isinstance(v, (int, float)) and 30000 <= float(v) <= 60000:
                dt = _excel_serial_to_date(float(v))
                if dt:
                    return (dt.year * 100 + dt.month, dt.strftime("%Y-%m-%d"))
            s = str(v).strip()
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
            if m:
                a, mes_n, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 2000 <= a <= 2050:
                    return (a * 100 + mes_n, f"{a:04d}-{mes_n:02d}-{d:02d}")
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
    return None


def _extract_fecha_from_filename(path: Path) -> tuple[int, str] | None:
    name = path.stem.lower()
    m = re.search(r"-([a-z]{2})(\d{4})$", name)
    if not m:
        return None
    mes = _MES_ABREV_SBS.get(m.group(1))
    if not mes:
        return None
    anio = int(m.group(2))
    if not (2000 <= anio <= 2050):
        return None
    eom = (datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)) - timedelta(
        days=1
    )
    return (anio * 100 + mes, eom.strftime("%Y-%m-%d"))


def _detect_tipo_entidad(path: Path) -> str:
    for part in path.parts:
        n = part.lower()
        if n in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[n]
    return "DESCONOCIDO"


def _norm_header(s: str) -> str:
    """Normaliza un header: lowercase, sin tildes, sin asteriscos/anotaciones."""
    return _strip_accents(s).lower().strip().rstrip("*").strip()


def _is_empresa_header(s: str | None) -> bool:
    return s is not None and _norm_header(s) in ("empresa", "empresas", "entidad", "entidades")


def _is_departamento_header(s: str | None) -> bool:
    return s is not None and _norm_header(s) in ("departamento", "departamentos", "depto")


def _detect_layout(sheet: XlsSheet) -> tuple[str, int] | None:
    """Detecta el layout del archivo de oficinas.

    Devuelve (layout, header_row) donde layout es 'horizontal' o 'transpuesto'.

    - **horizontal** (moderno 2015+, BANCOS desde 2009): col 0 = 'Empresas',
      col 1+ = departamentos. Una fila por empresa.
    - **transpuesto** (FINANCIERAS pre-2015): col 0 = 'Departamento',
      col 1+ = entidades. Una fila por departamento.

    Tolera asteriscos en el header ("Empresas*") y escanea cols 0-2 + rows 0-8.
    """
    for r in range(0, 8):
        for c_try in (0, 1):
            v = _safe_text(sheet.cell(r, c_try))
            if v is None:
                continue
            if _is_empresa_header(v):
                # Validar siguiente col tenga texto (un departamento)
                v_next = _safe_text(sheet.cell(r, c_try + 1))
                if v_next and not _to_int(v_next):
                    return ("horizontal", r)
            if _is_departamento_header(v):
                v_next = _safe_text(sheet.cell(r, c_try + 1))
                if v_next and not _to_int(v_next):
                    return ("transpuesto", r)
    return None


def _find_header_row(sheet: XlsSheet) -> int | None:
    """Compat: devuelve header_row si es layout horizontal, None si no.

    Para el detector completo (incluye transpuesto), usar `_detect_layout`.
    """
    layout = _detect_layout(sheet)
    if layout is None or layout[0] != "horizontal":
        return None
    return layout[1]


def _detect_departamentos(sheet: XlsSheet, header_row: int) -> list[tuple[str, int]]:
    """Lista los departamentos (nombre, col) del header horizontal. Excluye Total."""
    deptos: list[tuple[str, int]] = []
    for c in range(1, sheet.n_cols):
        v = _safe_text(sheet.cell(header_row, c))
        if not v:
            continue
        norm = _norm_header(v)
        if norm.startswith("total"):
            continue
        deptos.append((v, c))
    return deptos


def _detect_entidades_transpuesto(sheet: XlsSheet, header_row: int) -> list[tuple[str, int]]:
    """En layout transpuesto, las ENTIDADES estan en el header (col 1+).
    Excluye columna 'Total'.
    """
    entidades: list[tuple[str, int]] = []
    for c in range(1, sheet.n_cols):
        v = _safe_text(sheet.cell(header_row, c))
        if not v:
            continue
        norm = _norm_header(v)
        if norm.startswith("total"):
            continue
        entidades.append((v, c))
    return entidades


class MonthlyOficinasGridImporter:
    """Importer del topico oficinas: grid empresa x departamento -> long format."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 5_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_oficinas_grid.start", path=str(path))

        try:
            sheets = read_xls(path)
        except Exception as e:
            raise ValidationError(f"No pude leer {path}: {e}") from e
        if not sheets:
            raise ValidationError(f"Sin hojas en {path}")
        sheet = sheets[0]

        fecha = _extract_fecha(sheet) or _extract_fecha_from_filename(path)
        if not fecha:
            raise ValidationError(f"No pude extraer fecha de {path}")
        periodo, fecha_iso = fecha

        layout_info = _detect_layout(sheet)
        if layout_info is None:
            raise ValidationError(f"No detecte header 'Empresas' ni 'Departamento' en {path}")
        layout_kind, header_row = layout_info
        tipo_entidad = _detect_tipo_entidad(path)
        data_start = header_row + 1

        rows: list[tuple] = []
        if layout_kind == "horizontal":
            deptos = _detect_departamentos(sheet, header_row)
            if not deptos:
                raise ValidationError(f"No detecte departamentos en header de {path}")
            empresas_vistas: set[str] = set()
            for r in range(data_start, sheet.n_rows):
                empresa = _safe_text(sheet.cell(r, 0))
                if not empresa:
                    continue
                emp_norm = _strip_accents(empresa).lower()
                if (
                    emp_norm.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                    or len(empresa) < 3
                ):
                    continue
                if empresa in empresas_vistas:
                    continue
                empresas_vistas.add(empresa)
                for depto_nombre, depto_col in deptos:
                    val = _to_int(sheet.cell(r, depto_col))
                    if val is None:
                        continue
                    rows.append(
                        (
                            periodo,
                            fecha_iso,
                            tipo_entidad,
                            empresa,
                            depto_nombre,
                            val,
                            path.name,
                        )
                    )
        else:  # transpuesto
            entidades = _detect_entidades_transpuesto(sheet, header_row)
            if not entidades:
                raise ValidationError(f"No detecte entidades en header de {path}")
            deptos_vistos: set[str] = set()
            for r in range(data_start, sheet.n_rows):
                depto_nombre = _safe_text(sheet.cell(r, 0))
                if not depto_nombre:
                    continue
                depto_norm = _strip_accents(depto_nombre).lower()
                if (
                    depto_norm.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                    or len(depto_nombre) < 3
                ):
                    continue
                if depto_nombre in deptos_vistos:
                    continue
                deptos_vistos.add(depto_nombre)
                for entidad_nombre, entidad_col in entidades:
                    val = _to_int(sheet.cell(r, entidad_col))
                    if val is None:
                        continue
                    rows.append(
                        (
                            periodo,
                            fecha_iso,
                            tipo_entidad,
                            entidad_nombre,
                            depto_nombre,
                            val,
                            path.name,
                        )
                    )
            # Compat con flujo abajo
            empresas_vistas = deptos_vistos

        if not rows:
            return ImportResult(
                source="monthly_oficinas_grid",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=len(empresas_vistas),
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas extraidas",) if not empresas_vistas else (),
            )

        insert_sql = """
            INSERT INTO raw.oficinas_observacion (
                periodo, fecha_cierre, tipo_entidad, empresa, departamento,
                n_oficinas, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, tipo_entidad, empresa, departamento)
            DO UPDATE SET
                fecha_cierre = EXCLUDED.fecha_cierre,
                n_oficinas = EXCLUDED.n_oficinas,
                source_file = EXCLUDED.source_file,
                loaded_at = NOW()
        """
        inserted = 0
        for i in range(0, len(rows), self._batch_size):
            batch = rows[i : i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(insert_sql, batch)
            await self._conn.commit()
            inserted += len(batch)

        log.info(
            "monthly_oficinas_grid.done",
            inserted=inserted,
            periodo=periodo,
            tipo_entidad=tipo_entidad,
            layout=layout_kind,
            n_dims=len(empresas_vistas),
            duration_s=round(time.perf_counter() - start, 2),
        )
        return ImportResult(
            source="monthly_oficinas_grid",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )
