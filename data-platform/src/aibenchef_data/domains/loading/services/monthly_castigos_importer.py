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
    # Layout moderno (2010-07+): clasificacion granular SBS Res. 11356-2008
    ("Corporativo",       ["corporativ"]),
    ("Grandes Empresas",  ["grandes"]),
    ("Medianas Empresas", ["mediana"]),
    ("Pequeña Empresa",   ["peque"]),
    ("Microempresa",      ["micro", "mes"]),  # "mes" = layout viejo (Microempresa)
    ("Consumo",           ["consumo"]),
    ("Hipotecario",       ["hipotec"]),
    # Layout viejo (2009-2010 Jun): clasificacion agregada
    ("Comerciales",       ["comercial"]),
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


# Meses abreviados SBS en filenames: B-2369-<mes><año>.xls
_MES_ABREV_SBS = {
    "en": 1, "fe": 2, "ma": 3, "ab": 4, "my": 5, "jn": 6,
    "jl": 7, "ag": 8, "se": 9, "oc": 10, "no": 11, "di": 12,
}


def _extract_fecha_from_filename(path: Path) -> tuple[int, str] | None:
    """Fallback: extrae fecha del filename SBS standard.

    Patrones:
      B-2369-ma2010.xls    -> (201003, '2010-03-31')
      C-1253-di2014.xls    -> (201412, '2014-12-31')
    """
    name = path.stem.lower()
    m = re.search(r"-([a-z]{2})(\d{4})$", name)
    if not m:
        return None
    mes_abrev, anio_str = m.group(1), m.group(2)
    mes = _MES_ABREV_SBS.get(mes_abrev)
    if not mes:
        return None
    anio = int(anio_str)
    if not (2000 <= anio <= 2050):
        return None
    # Calcular ultimo dia del mes
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
            # Fallback: extraer del nombre del archivo (estándar SBS B-XXXX-<mes><año>.xls)
            fecha = _extract_fecha_from_filename(path)
        if not fecha:
            raise ValidationError(
                f"No pude extraer fecha de {path} (ni del contenido ni del filename)"
            )
        periodo, fecha_iso = fecha

        # Detectar header buscando el ROW DE PRODUCTOS directamente.
        # Recorremos las primeras 10 filas y para cada una contamos cuántas
        # columnas mapean a productos canonicos. La fila con mas matches es
        # el header de productos. Empresa col se infiere: col 0 si tiene texto
        # tipo entidad despues del header, sino col 1.
        producto_cols: list[tuple[str, int]] = []
        sub_header_row = None
        best_matches = 0
        for r in range(0, 12):
            cur_matches: list[tuple[str, int]] = []
            for c in range(0, sheet.n_cols):
                v = _safe_text(sheet.cell(r, c))
                if v:
                    canon = _producto_canonico(v)
                    if canon and not any(c == col for _, col in cur_matches):
                        cur_matches.append((canon, c))
            if len(cur_matches) > best_matches:
                best_matches = len(cur_matches)
                producto_cols = cur_matches
                sub_header_row = r
        if not producto_cols or sub_header_row is None:
            raise ValidationError(f"No detecte productos en {path}")

        # Detectar empresa_col: prueba col 0 y col 1 en la primera fila de data,
        # quedate con la que tenga texto que no sea numero.
        empresa_col = 0
        for try_col in (0, 1):
            v = _safe_text(sheet.cell(sub_header_row + 1, try_col))
            if v and not _to_num(v):
                empresa_col = try_col
                break
        # Fallback: si la primera fila de data esta vacia en col 0, buscar
        # la primera fila no-vacia y reintentar.
        if not _safe_text(sheet.cell(sub_header_row + 1, empresa_col)):
            for r2 in range(sub_header_row + 1, min(sub_header_row + 6, sheet.n_rows)):
                for try_col in (0, 1):
                    v = _safe_text(sheet.cell(r2, try_col))
                    if v and not _to_num(v) and len(v) >= 3:
                        empresa_col = try_col
                        break
                else:
                    continue
                break

        tipo_entidad = _detect_tipo_entidad(path)
        data_start = sub_header_row + 1

        rows: list[tuple] = []
        empresas_validas = 0  # estructura OK aunque los valores sean 0
        # Buscar empresas en cualquier fila después del header. En layout viejo
        # las empresas están en col 1; usamos empresa_col detectado arriba pero
        # con fallback: si col 0 está vacía, intentar col 1.
        for r in range(data_start, sheet.n_rows):
            emp = _safe_text(sheet.cell(r, empresa_col))
            if not emp and empresa_col == 0:
                emp = _safe_text(sheet.cell(r, 1))
            if not emp:
                continue
            emp_low = _strip_accents(emp).lower()
            if (emp_low.startswith(("total", "nota", "fuente", "(", "elaborac", "http", "*"))
                or len(emp) < 3):
                continue
            empresas_validas += 1
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
            # Si encontramos empresas pero todos sus valores son 0/null, el
            # archivo es valido — simplemente no hubo castigos ese mes.
            if empresas_validas > 0:
                return ImportResult(
                    source="monthly_castigos", source_file=path.name,
                    rows_inserted=0, rows_skipped=empresas_validas,
                    duration_seconds=time.perf_counter() - start,
                    errors=(),
                )
            return ImportResult(
                source="monthly_castigos", source_file=path.name,
                rows_inserted=0, rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas",),
            )

        # ----------------------------------------------------------------
        # REGLA DE NEGOCIO: Hasta 2015 la SBS publicaba castigos TRIMESTRAL
        # (Mar/Jun/Sep/Dic). A partir de 2016 publica MENSUAL. Para mantener
        # serie continua, distribuimos uniformemente el flujo trimestral en
        # los 3 meses del trimestre (cada mes recibe saldo_castigos / 3).
        #
        # Ej: Dic-2009 con 300 -> Oct-2009 100 + Nov-2009 100 + Dic-2009 100.
        # ----------------------------------------------------------------
        es_trimestral = periodo <= 201512 and (periodo % 100) in (3, 6, 9, 12)
        if es_trimestral:
            periodos_target = [
                _periodo_minus_months(periodo, 2),
                _periodo_minus_months(periodo, 1),
                periodo,
            ]
            fechas_target = [_periodo_to_eom_iso(p) for p in periodos_target]
            expanded: list[tuple] = []
            for r in rows:
                # row: (periodo, fecha_iso, emp, emp, tipo_entidad, canon, saldo, source, source_file)
                base_saldo = r[6]
                tercio = base_saldo / 3
                for pt, ft in zip(periodos_target, fechas_target, strict=True):
                    expanded.append((pt, ft, r[2], r[3], r[4], r[5], tercio, r[7], r[8]))
            rows = expanded
            log.info(
                "monthly_castigos.trimestral_distribuido",
                periodo_origen=periodo,
                periodos_target=periodos_target,
                filas_expandidas=len(rows),
            )

        # Dedup mismo grupo — borrar para todos los periodos que vamos a insertar
        # (asi si re-corremos un trimestre vie jo borra los 3 meses sinteticos antes
        # de re-insertar).
        periodos_a_borrar = sorted({r[0] for r in rows})
        async with self._conn.cursor() as cur:
            for p in periodos_a_borrar:
                await cur.execute(
                    "DELETE FROM raw.castigos_observacion "
                    "WHERE periodo=%s AND tipo_entidad=%s AND source='monthly_castigos'",
                    (p, tipo_entidad),
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

        log.info(
            "monthly_castigos.done",
            inserted=inserted, periodo_origen=periodo,
            es_trimestral=es_trimestral,
        )
        return ImportResult(
            source="monthly_castigos", source_file=path.name,
            rows_inserted=inserted, rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )


def _periodo_minus_months(periodo: int, n: int) -> int:
    """Resta n meses a YYYYMM. Ej: (200912, 2) -> 200910."""
    anio, mes = divmod(periodo, 100)
    mes_target = mes - n
    while mes_target <= 0:
        mes_target += 12
        anio -= 1
    return anio * 100 + mes_target


def _periodo_to_eom_iso(periodo: int) -> str:
    """Convierte YYYYMM a fecha de fin de mes ISO YYYY-MM-DD."""
    anio, mes = divmod(periodo, 100)
    if mes == 12:
        siguiente = datetime(anio + 1, 1, 1)
    else:
        siguiente = datetime(anio, mes + 1, 1)
    eom = siguiente - timedelta(days=1)
    return eom.strftime("%Y-%m-%d")
