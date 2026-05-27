"""MonthlyColocacionesImporter — carga los .xls mensuales SBS de tópico
colocaciones a raw.colocaciones_observacion.

Maneja DOS layouts diferentes:

1) HORIZONTAL (BANCA / FINANCIERA):
   R5: header productos (col 0='Empresas', col 1='Corporativo', col 5='Grandes', ...)
   R7: sub-header (Vigentes | Refinanc. y Reestruct. | Atrasados) por cada producto
   R9+: filas son entidades. Por cada producto: 3 columnas consecutivas con vig/ref/atr.

2) TRANSPUESTO (CMAC / CRAC / EDPYME):
   R3: header con entidades (col 0='Tipo de credito', col 1='Situacion', col 2+=entidades)
   R4+: filas son (producto, situación). El producto solo aparece en la primera fila
        del bloque (forward-fill); las situaciones son Vigentes / Refinanc / Atrasados.

Productos canonizados (output a raw.colocaciones_observacion.producto):
  'Corporativo', 'Grandes Empresas', 'Medianas Empresas',
  'Pequeña Empresa', 'Microempresa', 'Consumo', 'Hipotecario'
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


_MESES_ES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}


_MES_ABREV_SBS = {
    "en": 1,
    "fe": 2,
    "ma": 3,
    "ab": 4,
    "my": 5,
    "jn": 6,
    "jl": 7,
    "ag": 8,
    "se": 9,
    "oc": 10,
    "no": 11,
    "di": 12,
}


# Productos canonicos -> patrones de match (case insensitive, sin tildes)
_PRODUCTOS_CANON: list[tuple[str, list[str]]] = [
    ("Corporativo", ["corporativ"]),
    ("Grandes Empresas", ["grandes empresa"]),
    ("Medianas Empresas", ["medianas empresa"]),
    ("Pequeña Empresa", ["peque"]),  # "pequenas empresas" / "pequena empresa"
    ("Microempresa", ["micro"]),  # "microempresa" / "micro empresas"
    ("Consumo", ["consumo"]),
    ("Hipotecario", ["hipotec"]),
    # Layout 2009-2010 Jun (legacy aggregate): "Comerciales", "Actividades empresariales"
    ("Comerciales", ["comercial", "actividades empresar"]),
]


_EMPRESA_HEADER_WORDS = ("empresa", "empresas", "empresas*", "entidad", "entidades")


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _safe_text(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _to_num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").strip())
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


def _extract_fecha(sheet) -> tuple[int, str] | None:
    """Busca la fecha en filas 0-5. Soporta serial, ISO string, datetime, español."""
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
            # Texto en español: "Al 31 de Marzo de 2013"
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
    """Fallback: extrae fecha del filename SBS standard B-XXXX-<mes><año>.xls."""
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
    if mes == 12:
        eom = datetime(anio + 1, 1, 1) - timedelta(days=1)
    else:
        eom = datetime(anio, mes + 1, 1) - timedelta(days=1)
    return (anio * 100 + mes, eom.strftime("%Y-%m-%d"))


def _detect_tipo_entidad(path: Path) -> str:
    for part in path.parts:
        n = part.lower()
        if n in _TIPO_ENTIDAD_BY_FOLDER:
            return _TIPO_ENTIDAD_BY_FOLDER[n]
    return "DESCONOCIDO"


def _producto_canonico(raw: str) -> str | None:
    """Mapea un nombre de producto raw al canonico de raw.colocaciones."""
    if not raw:
        return None
    s = _strip_accents(raw).lower().strip()
    for canon, patrones in _PRODUCTOS_CANON:
        if any(p in s for p in patrones):
            return canon
    return None


def _detect_layout(sheet) -> str | None:
    """Devuelve 'horizontal' (BANCA/FIN) o 'transpuesto' (CMAC/CRAC/EDPYME)."""
    # En transpuesto, R3 col 0 = 'Tipo de credito' y col 1 = 'Situacion'.
    for r in range(0, 6):
        a = _safe_text(sheet.cell(r, 0))
        b = _safe_text(sheet.cell(r, 1))
        if (
            a
            and "tipo" in _strip_accents(a).lower()
            and b
            and "situaci" in _strip_accents(b).lower()
        ):
            return "transpuesto"
    # En horizontal, "Empresas" suele estar en col 0 (layout 2015+) o col 1
    # (layout BANCOS/FINANCIERA 2009-2014 con codigo numerico en col 0).
    # En el layout 2009 los productos son legacy ("Comerciales / A Microempresas /
    # Consumo / Hipotecarios"), no la taxonomia 2010+ ("Corporativo / Grandes / ...").
    for r in range(0, 8):
        for c_emp in (0, 1):
            a = _safe_text(sheet.cell(r, c_emp))
            if a and _strip_accents(a).lower().strip() in _EMPRESA_HEADER_WORDS:
                for c in range(c_emp + 1, sheet.n_cols):
                    v = _safe_text(sheet.cell(r, c))
                    if not v:
                        continue
                    v_low = _strip_accents(v).lower()
                    if (
                        "corporativ" in v_low
                        or "comercial" in v_low
                        or "microempresa" in v_low
                        or v_low == "consumo"
                        or "hipotec" in v_low
                    ):
                        return "horizontal"
    return None


# ============================================================================
# PARSER HORIZONTAL (BANCA / FINANCIERA)
# ============================================================================
def _parse_horizontal(sheet) -> tuple[list[dict], int]:
    """Devuelve (rows, header_data_start) donde rows = list de
    {empresa, producto, saldo_vig, saldo_ref, saldo_atr, saldo_total}."""
    # Encontrar fila header productos. 'Empresas' puede estar en col 0 o col 1.
    header_row = None
    empresa_col = 0
    for r in range(0, 8):
        for c_try in (0, 1):
            a = _safe_text(sheet.cell(r, c_try))
            if a and _strip_accents(a).lower().strip() in _EMPRESA_HEADER_WORDS:
                header_row = r
                empresa_col = c_try
                break
        if header_row is not None:
            break
    if header_row is None:
        return [], -1

    # Mapear cada producto a su columna de inicio (donde aparece el nombre en header_row)
    producto_cols: list[tuple[str, int]] = []
    for c in range(empresa_col + 1, sheet.n_cols):
        v = _safe_text(sheet.cell(header_row, c))
        if v:
            canon = _producto_canonico(v)
            if canon:
                producto_cols.append((canon, c))
    if not producto_cols:
        return [], -1

    # Validar que la siguiente fila (header_row+2 generalmente) tenga "Vigentes"
    # justo en la columna del producto. Si no, intentar header_row+1 o +2.
    sub_header_row = None
    for cand in (header_row + 1, header_row + 2):
        if cand >= sheet.n_rows:
            continue
        v = _safe_text(sheet.cell(cand, producto_cols[0][1]))
        if v and "vigent" in _strip_accents(v).lower():
            sub_header_row = cand
            break
    if sub_header_row is None:
        sub_header_row = header_row + 2

    data_start = sub_header_row + 2  # fila vacia + data

    rows: list[dict] = []
    for r in range(data_start, sheet.n_rows):
        emp = _safe_text(sheet.cell(r, empresa_col))
        if not emp:
            continue
        emp_low = _strip_accents(emp).lower()
        if (
            emp_low.startswith("total")
            or emp_low.startswith("nota")
            or emp_low.startswith("fuente")
            or emp_low.startswith("(")
            or emp_low.startswith("elaborac")
            or len(emp) < 3
        ):
            continue
        for canon, c in producto_cols:
            vig = _to_num(sheet.cell(r, c))
            ref = _to_num(sheet.cell(r, c + 1))
            atr = _to_num(sheet.cell(r, c + 2))
            vig = vig or 0.0
            ref = ref or 0.0
            atr = atr or 0.0
            total = vig + ref + atr
            if total <= 0:
                continue
            rows.append(
                {
                    "empresa": emp,
                    "producto": canon,
                    "saldo_vigente": vig,
                    "saldo_reest_refin": ref,
                    "saldo_atrasado": atr,
                    "saldo_total": total,
                }
            )
    return rows, data_start


# ============================================================================
# PARSER TRANSPUESTO (CMAC / CRAC / EDPYME)
# ============================================================================
def _parse_transpuesto(sheet) -> tuple[list[dict], int]:
    # Encontrar fila header (col 0 = 'Tipo de credito' Y col 1 = 'Situacion').
    # Ambas son requeridas para evitar matchear el titulo de R0 que tambien
    # contiene la palabra "tipo".
    header_row = None
    for r in range(0, 8):
        a = _safe_text(sheet.cell(r, 0))
        b = _safe_text(sheet.cell(r, 1))
        if (
            a
            and b
            and "tipo" in _strip_accents(a).lower()
            and "situaci" in _strip_accents(b).lower()
        ):
            header_row = r
            break
    if header_row is None:
        return [], -1

    # Mapear cada columna >= 2 a su entidad
    entidad_cols: list[tuple[str, int]] = []
    for c in range(2, sheet.n_cols):
        v = _safe_text(sheet.cell(header_row, c))
        if not v:
            continue
        v_low = _strip_accents(v).lower()
        if v_low.startswith("total"):  # ignorar columnas de total
            continue
        entidad_cols.append((v, c))

    if not entidad_cols:
        return [], -1

    # Iterar filas de data con forward-fill del producto
    current_producto = None
    # Acumulador: {(empresa, producto) -> {vig, ref, atr}}
    acumulador: dict[tuple[str, str], dict[str, float]] = {}

    for r in range(header_row + 1, sheet.n_rows):
        col0 = _safe_text(sheet.cell(r, 0))
        col1 = _safe_text(sheet.cell(r, 1))

        if col0:
            # Nuevo producto. Detectar si es valido.
            canon = _producto_canonico(col0)
            if canon:
                current_producto = canon
            else:
                # Otra fila (Total, Nota, etc.) — termina seccion
                if (
                    _strip_accents(col0)
                    .lower()
                    .startswith(("total", "nota", "fuente", "elaborac", "http", "*"))
                ):
                    current_producto = None
                    continue

        if current_producto is None or not col1:
            continue

        # col1 = situacion: Vigentes / Refinanc. y Reestruct. / Atrasados
        col1_low = _strip_accents(col1).lower()
        if "vigent" in col1_low:
            sit_key = "vig"
        elif "refinan" in col1_low or "reestruc" in col1_low:
            sit_key = "ref"
        elif "atrasa" in col1_low:
            sit_key = "atr"
        else:
            continue

        for emp, c in entidad_cols:
            v = _to_num(sheet.cell(r, c))
            if v is None:
                continue
            key = (emp, current_producto)
            slot = acumulador.setdefault(key, {"vig": 0.0, "ref": 0.0, "atr": 0.0})
            slot[sit_key] += v

    rows: list[dict] = []
    for (emp, prod), vals in acumulador.items():
        total = vals["vig"] + vals["ref"] + vals["atr"]
        if total <= 0:
            continue
        rows.append(
            {
                "empresa": emp,
                "producto": prod,
                "saldo_vigente": vals["vig"],
                "saldo_reest_refin": vals["ref"],
                "saldo_atrasado": vals["atr"],
                "saldo_total": total,
            }
        )
    return rows, header_row + 1


# ============================================================================
class MonthlyColocacionesImporter:
    """Importer de .xls SBS mensuales de colocaciones."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_coloc.start", path=str(path))

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

        layout = _detect_layout(sheet)
        if not layout:
            raise ValidationError(f"No pude detectar layout en {path}")

        tipo_entidad = _detect_tipo_entidad(path)

        if layout == "horizontal":
            parsed, _ = _parse_horizontal(sheet)
        else:
            parsed, _ = _parse_transpuesto(sheet)

        if not parsed:
            return ImportResult(
                source="monthly_colocaciones",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=(f"sin rows extraidas con layout={layout}",),
            )

        # UPSERT idempotente
        insert_sql = """
            INSERT INTO raw.colocaciones_observacion (
                periodo, fecha_cierre, empresa, tipo_entidad, producto,
                saldo_vigente, saldo_reest_refin, saldo_atrasado, saldo_total,
                source, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion, prod_consumo)
            DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                saldo_vigente = EXCLUDED.saldo_vigente,
                saldo_reest_refin = EXCLUDED.saldo_reest_refin,
                saldo_atrasado = EXCLUDED.saldo_atrasado,
                saldo_total = EXCLUDED.saldo_total,
                source = EXCLUDED.source,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        rows_tuples = [
            (
                periodo,
                fecha_iso,
                r["empresa"],
                tipo_entidad,
                r["producto"],
                r["saldo_vigente"],
                r["saldo_reest_refin"],
                r["saldo_atrasado"],
                r["saldo_total"],
                "monthly_colocaciones",
                path.name,
            )
            for r in parsed
        ]

        inserted = 0
        for i in range(0, len(rows_tuples), self._batch_size):
            batch = rows_tuples[i : i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(insert_sql, batch)
            await self._conn.commit()
            inserted += len(batch)

        log.info(
            "monthly_coloc.done",
            inserted=inserted,
            periodo=periodo,
            layout=layout,
            duration_s=round(time.perf_counter() - start, 2),
        )

        return ImportResult(
            source="monthly_colocaciones",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )
