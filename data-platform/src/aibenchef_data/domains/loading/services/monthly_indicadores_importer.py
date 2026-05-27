"""MonthlyIndicadoresImporter — carga los .xls mensuales SBS de indicadores
prudenciales (topico 10) a raw.indicadores_prudenciales.

Layout del archivo SBS (B-2401 BANCOS, B-3301 FINANCIERAS, C-1301 CMAC,
C-2301 CRAC, C-4301 EDPYMES):

- R1, col 0: titulo "Indicadores Financieros por Empresa..."
- R2, col 0: fecha "2024-12-31 00:00:00" o serial Excel
- R3, col 0: unidad "( En porcentaje )"
- R5, col 1+: nombres de entidades distribuidos en BLOQUES horizontales
              (8-10 entidades por bloque, separados por una columna en blanco)
- R6, col 1+: continuacion de nombres largos de entidades (line-wrap)
- R8+: filas alternan entre encabezado de seccion (SOLVENCIA, etc) y rows
       de indicador con valores por entidad.

Estructura multi-bloque:
- BANCOS tipico: 2-3 bloques de 8 entidades + columna "Total Banca Multiple"
- Cada bloque repite el nombre del indicador en col 0 del bloque
- Una columna vacia separa los bloques

Output a raw.indicadores_prudenciales (long-format):
- 1 fila por (periodo, tipo_entidad, entidad, indicador_slug)
- Idempotente via ON CONFLICT (periodo, tipo_entidad, entidad, indicador_slug)
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


# Mapeo de strings de seccion (uppercase, sin tildes) -> canon
_SECCIONES_CANON: dict[str, str] = {
    "SOLVENCIA": "SOLVENCIA",
    "CALIDAD DE ACTIVOS": "CALIDAD_ACTIVOS",
    "CALIDAD DE ACTIVOS**": "CALIDAD_ACTIVOS",
    "EFICIENCIA Y GESTION": "EFICIENCIA",
    "RENTABILIDAD": "RENTABILIDAD",
    "LIQUIDEZ": "LIQUIDEZ",
}


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
    s = str(v).strip().replace(",", "")
    if not s or s == "-":
        return None
    try:
        return float(s)
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
    """Busca fecha en filas 0-5. Soporta datetime, serial, ISO, español."""
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


def _seccion_canonica(raw: str) -> str | None:
    if not raw:
        return None
    s = _strip_accents(raw).upper().strip().rstrip("*").strip()
    return _SECCIONES_CANON.get(s)


def _indicador_slug(nombre: str) -> str:
    """Genera un slug estable para un indicador. Elimina parentesis con
    fechas relativas ("al 30/11/2024") y notas marcadas con * o **.
    """
    s = _strip_accents(nombre).lower().strip()
    # Quitar parentesis con contenido (incluyen fechas, anotaciones)
    s = re.sub(r"\([^)]*\)", "", s)
    # Quitar asteriscos de notas
    s = s.replace("*", "")
    # Quitar caracteres no alfanumericos a underscore
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s


def _detect_entity_blocks(sheet: XlsSheet) -> list[tuple[int, list[tuple[str, int]]]]:
    """Detecta los bloques horizontales de entidades.

    Cada bloque es (indicador_col, [(entity_name, value_col), ...]).
    El indicador_col es la primera col de cada bloque (donde aparece el nombre
    del indicador), y las value_cols son las cols subsiguientes con valores.

    SBS estructura: |indicador|ent1|ent2|...|ent8|  |indicador|ent9|...|ent16|...
    Los bloques se separan por una columna en blanco.
    """
    # Primero, obtenemos nombres de entidades en row 5 (a veces overflow a row 6)
    entity_cols: dict[int, str] = {}
    for c in range(0, sheet.n_cols):
        name_parts: list[str] = []
        for r in (5, 6):
            v = _safe_text(sheet.cell(r, c))
            if v:
                name_parts.append(v)
        if name_parts:
            entity_cols[c] = " ".join(name_parts)

    if not entity_cols:
        return []

    # Identificar columnas de indicadores (col 0 + cualquier col donde el row 5
    # NO tenga entity, pero el row 9 SI tenga texto, en multi-bloque).
    # Heuristica simple: col 0 es siempre indicador. Las demas cols indicador son
    # las cols vacias en row 5 que estan entre bloques de entities.
    sorted_entity_cols = sorted(entity_cols.keys())
    bloques: list[tuple[int, list[tuple[str, int]]]] = []

    # Encontrar gaps (cols sin entity) — cada gap precede un nuevo bloque
    indicador_cols = [0]
    if sorted_entity_cols:
        prev = sorted_entity_cols[0]
        for ec in sorted_entity_cols[1:]:
            if ec - prev > 1:
                # gap detectado, la col del gap es un indicator-col del proximo bloque
                indicador_cols.append(prev + 1)
            prev = ec

    for i, icol in enumerate(indicador_cols):
        # Entidades del bloque: las cols entre este icol y el siguiente icol
        next_icol = indicador_cols[i + 1] if i + 1 < len(indicador_cols) else sheet.n_cols
        block_entities = [(entity_cols[c], c) for c in sorted_entity_cols if icol < c < next_icol]
        if block_entities:
            bloques.append((icol, block_entities))

    return bloques


class MonthlyIndicadoresImporter:
    """Importer de .xls SBS mensuales de indicadores prudenciales."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 1_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path) -> ImportResult:
        start = time.perf_counter()
        log.info("monthly_indicadores.start", path=str(path))

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

        bloques = _detect_entity_blocks(sheet)
        if not bloques:
            raise ValidationError(f"No detecte bloques de entidades en {path}")

        tipo_entidad = _detect_tipo_entidad(path)

        # Recorrer las filas: si col 0 tiene seccion canonica, actualizar contexto.
        # Si tiene nombre de indicador, emitir (entidad, valor) por cada entidad
        # del bloque correspondiente.
        rows: list[tuple] = []
        seccion_actual: str | None = None
        seen_keys: set[tuple[str, str]] = set()  # dedup (entidad, indicador_slug)

        for r in range(7, sheet.n_rows):
            v_col0 = _safe_text(sheet.cell(r, 0))
            if not v_col0:
                continue
            canon_seccion = _seccion_canonica(v_col0)
            if canon_seccion:
                seccion_actual = canon_seccion
                continue
            if seccion_actual is None:
                continue
            # Skip filas de notas/glosario
            v_low = _strip_accents(v_col0).lower()
            if v_low.startswith(("nota", "fuente", "los valores", "* ", "** ", "(", "elabor")):
                continue
            # Es una fila de indicador. Por cada bloque, emitir valores.
            indicador = v_col0
            slug = _indicador_slug(indicador)
            if not slug:
                continue

            for icol, block_entities in bloques:
                # El nombre del indicador del bloque deberia ser identico al de col 0;
                # si difiere significativamente, podria ser un layout no estandar — lo
                # toleramos pero registramos warning.
                v_block_indicator = _safe_text(sheet.cell(r, icol))
                if v_block_indicator and _indicador_slug(v_block_indicator) != slug:
                    log.debug(
                        "monthly_indicadores.indicador_mismatch",
                        row=r,
                        col=icol,
                        esperado=slug,
                        encontrado=_indicador_slug(v_block_indicator),
                    )
                for entidad, value_col in block_entities:
                    val = _to_num(sheet.cell(r, value_col))
                    if val is None:
                        continue
                    key = (entidad, slug)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    rows.append(
                        (
                            periodo,
                            fecha_iso,
                            tipo_entidad,
                            entidad,
                            seccion_actual,
                            indicador,
                            slug,
                            val,
                            path.name,
                        )
                    )

        if not rows:
            return ImportResult(
                source="monthly_indicadores",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=0,
                duration_seconds=time.perf_counter() - start,
                errors=("sin filas extraidas",),
            )

        insert_sql = """
            INSERT INTO raw.indicadores_prudenciales (
                periodo, fecha_cierre, tipo_entidad, entidad,
                seccion, indicador, indicador_slug, valor,
                source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, tipo_entidad, entidad, indicador_slug)
            DO UPDATE SET
                fecha_cierre = EXCLUDED.fecha_cierre,
                seccion = EXCLUDED.seccion,
                indicador = EXCLUDED.indicador,
                valor = EXCLUDED.valor,
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
            "monthly_indicadores.done",
            inserted=inserted,
            periodo=periodo,
            tipo_entidad=tipo_entidad,
            bloques=len(bloques),
            duration_s=round(time.perf_counter() - start, 2),
        )
        return ImportResult(
            source="monthly_indicadores",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=0,
            duration_seconds=time.perf_counter() - start,
            errors=(),
        )
