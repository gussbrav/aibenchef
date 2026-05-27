"""MonthlyClientesAhorroImporter — carga .xls mensuales SBS topico 06 (Clientes Ahorro).

Layout del archivo SBS:
  R1: titulo "Numero de Personas Deudoras..."
  R2: fecha "Al 30 de Junio de 2009"
  R5: header de productos en cols 2,5,8,11:
      "Depositos a la Vista", "Depositos de Ahorro", "Depositos a Plazo", "Depositos CTS"
  R6: sub-headers: "Personas Naturales", "Personas Juridicas sin fines de lucro",
                    "Otras Personas Juridicas" (3 sub-cols por producto)
  R8+: data. Col 1 = empresa, cols 2-13 = valores (4 productos × 3 sub-cols).

Distribucion trimestral (igual que castigos): hasta 2015 SBS publicaba trimestral
(Mar/Jun/Sep/Dic). Distribuimos uniformemente entre los 3 meses del trimestre
para mantener serie continua mensual.

Tabla destino: raw.clientes_ahorros
  - producto: "Vista" / "Ahorro" / "Plazo" / "CTS"
  - n_pers_nat, n_pers_jur_no_lucro, n_otras_pers_jur, n_total
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

# Productos canonicos -> patrones de match
_PRODUCTOS_PATRONES = [
    ("Vista", ["vista"]),
    ("Ahorro", ["ahorro"]),
    ("Plazo", ["plazo"]),
    ("CTS", ["cts"]),
]

# Sub-columnas dentro de cada producto (orden: PN, PJ no lucro, Otras PJ)
_SUBCOLS_PATRONES = [
    ("pers_nat", ["naturales", "natural"]),
    ("pers_jur_no_lucro", ["fines de lucro", "sin fines", "no lucro"]),
    ("otras_pers_jur", ["otras personas"]),
]


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
        s = str(v).strip().replace(",", "")
        if not s or s == "-":
            return None
        return int(float(s))
    except (ValueError, TypeError):
        return None


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


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
        for c in range(0, 5):
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
    if not raw:
        return None
    s = _strip_accents(raw).lower().strip()
    for canon, pats in _PRODUCTOS_PATRONES:
        if any(p in s for p in pats):
            return canon
    return None


def _subcol_canonica(raw: str) -> str | None:
    if not raw:
        return None
    s = _strip_accents(raw).lower().strip()
    for canon, pats in _SUBCOLS_PATRONES:
        if any(p in s for p in pats):
            return canon
    return None


def _periodo_minus_months(periodo: int, n: int) -> int:
    anio, mes = divmod(periodo, 100)
    mes_target = mes - n
    while mes_target <= 0:
        mes_target += 12
        anio -= 1
    return anio * 100 + mes_target


def _periodo_to_eom_iso(periodo: int) -> str:
    anio, mes = divmod(periodo, 100)
    siguiente = datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)
    eom = siguiente - timedelta(days=1)
    return eom.strftime("%Y-%m-%d")


class MonthlyClientesAhorroImporter:
    """Importer de XLS mensuales SBS de clientes con ahorro."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def _import_inverted_layout(
        self,
        sheet,
        path: Path,
        periodo: int,
        fecha_iso: str,
        start: float,
    ) -> ImportResult:
        """Layout 2009-2010 Jun: persona-type en OUTER row, productos en INNER row.

        R3: "Empresas | | Personas Naturales | | | | Personas Juridicas... | ..."
        R4: "        | | Ahorro | Plazo | Total | | Ahorro | Plazo | Total | ..."
        R6+ data. El layout viejo SOLO tiene Ahorro+Plazo (no Vista, no CTS).
        """
        # Buscar persona-row: la primera row donde aparezcan canónicos de persona
        persona_row = None
        persona_cols: list[tuple[str, int]] = []
        for r in range(0, 12):
            cur: list[tuple[str, int]] = []
            for c in range(0, sheet.n_cols):
                v = _safe_text(sheet.cell(r, c))
                if v:
                    canon = _subcol_canonica(v)
                    if canon and not any(c == col for _, col in cur):
                        cur.append((canon, c))
            if len(cur) >= 2:  # al menos 2 tipos de persona detectados
                persona_row = r
                persona_cols = cur
                break
        if persona_row is None or not persona_cols:
            raise ValidationError(f"No detecte sub-columnas (Pers Nat/PJ) en {path}")

        # Producto row es la siguiente (R4 en el ejemplo)
        prod_row = persona_row + 1
        # Detectar columnas de productos
        prod_cols: list[tuple[str, int]] = []
        for c in range(0, sheet.n_cols):
            v = _safe_text(sheet.cell(prod_row, c))
            if v:
                canon = _producto_canonico(v)
                if canon:
                    prod_cols.append((canon, c))
        if not prod_cols:
            raise ValidationError(
                f"Layout invertido detectado pero no productos en row {prod_row} de {path}"
            )

        # Mapear (persona_canon, producto_canon) -> col_index. Cada persona span
        # va desde su col hasta la col del siguiente persona.
        persona_cols_sorted = sorted(persona_cols, key=lambda x: x[1])
        spans: dict[str, tuple[int, int]] = {}
        for i, (pc, col) in enumerate(persona_cols_sorted):
            end = persona_cols_sorted[i + 1][1] if i + 1 < len(persona_cols_sorted) else 999
            spans[pc] = (col, end)

        per_persona_prod: dict[str, dict[str, int]] = {}  # persona -> {producto -> col}
        for persona_canon, (lo, hi) in spans.items():
            mapping: dict[str, int] = {}
            for prod_canon, prod_col in prod_cols:
                if lo <= prod_col < hi and prod_canon not in mapping:
                    mapping[prod_canon] = prod_col
            per_persona_prod[persona_canon] = mapping

        tipo_entidad = _detect_tipo_entidad(path)
        data_start = prod_row + 1

        # Empresa col: probar col 0 y col 1
        empresa_col = 0
        for r2 in range(data_start, min(data_start + 6, sheet.n_rows)):
            for try_col in (0, 1):
                v = _safe_text(sheet.cell(r2, try_col))
                if v and not _to_int(v) and len(v) >= 3:
                    empresa_col = try_col
                    break
            else:
                continue
            break

        rows: list[tuple] = []
        for r in range(data_start, sheet.n_rows):
            emp = _safe_text(sheet.cell(r, empresa_col))
            if not emp:
                continue
            emp_low = _strip_accents(emp).lower()
            if (
                emp_low.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                or len(emp) < 3
            ):
                continue

            # Para cada producto canonico (Ahorro, Plazo en layout viejo),
            # juntar valor de cada persona-type.
            productos_disponibles: set[str] = set()
            for pmap in per_persona_prod.values():
                productos_disponibles.update(pmap.keys())

            for prod_canon in productos_disponibles:
                pn = _to_int(
                    sheet.cell(r, per_persona_prod.get("pers_nat", {}).get(prod_canon, -1))
                )
                pjl = _to_int(
                    sheet.cell(r, per_persona_prod.get("pers_jur_no_lucro", {}).get(prod_canon, -1))
                )
                opj = _to_int(
                    sheet.cell(r, per_persona_prod.get("otras_pers_jur", {}).get(prod_canon, -1))
                )
                vals = [v for v in (pn, pjl, opj) if v is not None]
                if not vals:
                    continue
                total = sum(vals)
                if total <= 0:
                    continue
                rows.append(
                    (
                        periodo,
                        fecha_iso,
                        emp,
                        None,
                        tipo_entidad,
                        None,
                        None,
                        prod_canon,
                        pn,
                        pjl,
                        opj,
                        total,
                        "monthly_clientes_ahorro",
                        path.name,
                    )
                )

        if not rows:
            return ImportResult(
                source="monthly_clientes_ahorro",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas (layout invertido)",),
            )

        periodos_a_borrar = sorted({r[0] for r in rows})
        async with self._conn.cursor() as cur:
            for p in periodos_a_borrar:
                await cur.execute(
                    "DELETE FROM raw.clientes_ahorros "
                    "WHERE periodo=%s AND tipo_entidad=%s AND source='monthly_clientes_ahorro'",
                    (p, tipo_entidad),
                )

        insert_sql = """
            INSERT INTO raw.clientes_ahorros (
                periodo, fecha_cierre, empresa, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_mype, producto,
                n_pers_nat, n_pers_jur_no_lucro, n_otras_pers_jur, n_total,
                source, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion) DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                n_pers_nat = EXCLUDED.n_pers_nat,
                n_pers_jur_no_lucro = EXCLUDED.n_pers_jur_no_lucro,
                n_otras_pers_jur = EXCLUDED.n_otras_pers_jur,
                n_total = EXCLUDED.n_total,
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

        return ImportResult(
            source="monthly_clientes_ahorro",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_clie_aho.start", path=str(path))

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

        # Detectar producto-row buscando row con max matches de productos canonicos
        producto_cols: list[tuple[str, int]] = []
        producto_row = None
        best = 0
        for r in range(0, 14):
            cur: list[tuple[str, int]] = []
            for c in range(0, sheet.n_cols):
                v = _safe_text(sheet.cell(r, c))
                if v:
                    canon = _producto_canonico(v)
                    if canon and not any(c == col for _, col in cur):
                        cur.append((canon, c))
            if len(cur) > best:
                best = len(cur)
                producto_cols = cur
                producto_row = r
        if not producto_cols or producto_row is None:
            raise ValidationError(f"No detecte productos en {path}")

        # Detectar sub-header row (row siguiente con "Personas...")
        sub_row = producto_row + 1
        subcols_in_row: list[tuple[str, int]] = []
        for c in range(0, sheet.n_cols):
            v = _safe_text(sheet.cell(sub_row, c))
            if v:
                canon = _subcol_canonica(v)
                if canon:
                    subcols_in_row.append((canon, c))
        if not subcols_in_row:
            # Layout VIEJO (2009-2010 Jun): personas en OUTER, productos en INNER.
            # Ejemplo R3: "Empresas |  | Personas Naturales |  |  |  | PJ no lucro | ..."
            #         R4: "        |  | Ahorro | Plazo | Total | | Ahorro | Plazo |..."
            return await self._import_inverted_layout(
                sheet,
                path,
                periodo,
                fecha_iso,
                start,
            )

        # Para cada producto, mapear sub-col -> col_index:
        # subcols_in_row tiene una secuencia (pers_nat, pers_jur_no_lucro, otras_pers_jur)
        # que se repite por cada producto. Asignamos secuencialmente.
        # producto_cols ordenado por col asc, lo mismo subcols_in_row.
        producto_cols_sorted = sorted(producto_cols, key=lambda x: x[1])
        subcols_sorted = sorted(subcols_in_row, key=lambda x: x[1])

        # Cada producto tiene 3 sub-cols consecutivas
        # Estructura: producto -> {subcol: col_index}
        producto_subcols: dict[str, dict[str, int]] = {}
        for i, (canon_prod, prod_col) in enumerate(producto_cols_sorted):
            next_prod_col = (
                producto_cols_sorted[i + 1][1] if i + 1 < len(producto_cols_sorted) else 999
            )
            # tomar las sub-cols entre prod_col y next_prod_col
            local_subs: dict[str, int] = {}
            for canon_sub, sub_col in subcols_sorted:
                # Solo nos quedamos con la PRIMERA aparicion de cada subcol_canon
                if prod_col <= sub_col < next_prod_col and canon_sub not in local_subs:
                    local_subs[canon_sub] = sub_col
            producto_subcols[canon_prod] = local_subs

        tipo_entidad = _detect_tipo_entidad(path)
        data_start = sub_row + 1

        # Detectar empresa_col: prueba 0, 1 en primera row no vacia despues de header
        empresa_col = 0
        for r2 in range(data_start, min(data_start + 5, sheet.n_rows)):
            for try_col in (1, 0):
                v = _safe_text(sheet.cell(r2, try_col))
                if v and not _to_int(v) and len(v) >= 3:
                    empresa_col = try_col
                    break
            else:
                continue
            break

        rows: list[tuple] = []
        for r in range(data_start, sheet.n_rows):
            emp = _safe_text(sheet.cell(r, empresa_col))
            if not emp:
                continue
            emp_low = _strip_accents(emp).lower()
            if (
                emp_low.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                or len(emp) < 3
            ):
                continue

            for prod_canon, subs in producto_subcols.items():
                pn = (
                    _to_int(sheet.cell(r, subs.get("pers_nat", -1))) if "pers_nat" in subs else None
                )
                pjl = (
                    _to_int(sheet.cell(r, subs.get("pers_jur_no_lucro", -1)))
                    if "pers_jur_no_lucro" in subs
                    else None
                )
                opj = (
                    _to_int(sheet.cell(r, subs.get("otras_pers_jur", -1)))
                    if "otras_pers_jur" in subs
                    else None
                )
                # n_total = suma de los 3 (si todos None, skip)
                vals = [v for v in (pn, pjl, opj) if v is not None]
                if not vals:
                    continue
                total = sum(vals)
                if total <= 0:
                    continue
                rows.append(
                    (
                        periodo,
                        fecha_iso,
                        emp,
                        None,
                        tipo_entidad,
                        None,
                        None,
                        prod_canon,
                        pn,
                        pjl,
                        opj,
                        total,
                        "monthly_clientes_ahorro",
                        path.name,
                    )
                )

        # Nota: clientes_ahorro SBS viene MENSUAL desde 2009 — NO requiere
        # distribucion trimestral (a diferencia de castigos que sí lo necesita).

        if not rows:
            return ImportResult(
                source="monthly_clientes_ahorro",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas",),
            )

        periodos_a_borrar = sorted({r[0] for r in rows})
        async with self._conn.cursor() as cur:
            for p in periodos_a_borrar:
                await cur.execute(
                    "DELETE FROM raw.clientes_ahorros "
                    "WHERE periodo=%s AND tipo_entidad=%s AND source='monthly_clientes_ahorro'",
                    (p, tipo_entidad),
                )

        insert_sql = """
            INSERT INTO raw.clientes_ahorros (
                periodo, fecha_cierre, empresa, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_mype, producto,
                n_pers_nat, n_pers_jur_no_lucro, n_otras_pers_jur, n_total,
                source, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion) DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                n_pers_nat = EXCLUDED.n_pers_nat,
                n_pers_jur_no_lucro = EXCLUDED.n_pers_jur_no_lucro,
                n_otras_pers_jur = EXCLUDED.n_otras_pers_jur,
                n_total = EXCLUDED.n_total,
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

        return ImportResult(
            source="monthly_clientes_ahorro",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )
