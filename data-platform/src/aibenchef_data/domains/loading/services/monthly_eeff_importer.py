"""MonthlyEeffImporter — carga un .xls mensual SBS a raw.eeff_observacion.

Layout transpuesto vs BASE EE.FF..xlsx:
    Filas = cuentas (sin codigo regulatorio, solo nombre).
    Columnas = (entidad x moneda).

Estructura tipica:
    row 1: titulo "Balance General/Estado de Ganancias..."
    row 2: fecha cierre como serial Excel
    row 3: "(En Miles de Soles)"
    row 4: vacia
    row 5: nombres de entidades cada 4 columnas
    row 6: monedas MN | ME | TOTAL repetidas
    row 7: vacia
    row 8+: filas de cuentas (col 0 = nombre, col 1+ = valores)

Estrategia de matching nombre -> codigo:
    No se puede match plano por nombre porque "Otros" aparece bajo varias
    cuentas L2. Strategy: stateful traversal.

    Cuando vemos una cuenta en MAYUSCULAS -> es L2 (parent de las siguientes
    cuentas mixed-case hasta el proximo MAYUSCULAS).

    Cuando vemos mixed-case -> es L3 cuyo parent es el ultimo L2 visto.

    Lookup en dim_cuenta:
        - L2: por tipo_estado + nombre normalizado, nivel=2
        - L3: por tipo_estado + nombre normalizado + parent_codigo = ultimo L2

Asterisco al final del nombre se normaliza ("Vigentes*" -> "Vigentes").
"""

from __future__ import annotations

import contextlib
import re
import time
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg

from aibenchef_data.domains.parsing import XlsSheet, read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)


# Sheet prefixes -> tipo_estado (formato BIFF de CMAC/CRAC/EDPYMES)
_BG_SHEET_PREFIXES = ("bg_",)  # bg_cm, bg_bm, bg_fi, bg_cr, bg_ed
_ER_SHEET_PREFIXES = ("gyp_", "egyp_", "er_")  # gyp_cm, etc.


def _classify_sheet(sheet: XlsSheet) -> str | None:
    """Clasifica una hoja como 'balance' o 'resultados' o None.

    Estrategia:
    1. Prefix del nombre de hoja (CMAC/CRAC/EDPYME usan bg_* / gyp_*)
    2. Contenido de las primeras filas (BANCOS/FINANCIERAS usan '1' / '2' como
       nombre, no son indicativos — detectamos por titulo en row 0-3 col 0).
    """
    name_lower = sheet.name.lower()
    if name_lower.startswith(_BG_SHEET_PREFIXES):
        return "balance"
    if name_lower.startswith(_ER_SHEET_PREFIXES):
        return "resultados"

    # Heuristica por contenido. Las primeras filas contienen el titulo.
    for r in range(0, 5):
        v = sheet.cell(r, 0)
        if v is None:
            continue
        text = str(v).strip().lower()
        if "balance general" in text:
            return "balance"
        if (
            "estado de ganancias" in text
            or "estado de resultados" in text
            or "estado de perdidas" in text  # acentos pueden venir mal
        ):
            return "resultados"
    return None


class MonthlyEeffImporter:
    """Importa un archivo .xls mensual SBS a raw.eeff_observacion."""

    def __init__(
        self,
        conn: psycopg.AsyncConnection,
        *,
        batch_size: int = 10_000,
    ) -> None:
        self._conn = conn
        self._batch_size = batch_size
        self._lookup_cache: dict[str, _CuentaLookup] = {}

    async def import_file(self, path: Path, *, tipo_entidad: str | None = None) -> ImportResult:
        """Importa un archivo SBS mensual.

        Args:
            path: Ruta al .xls SBS.
            tipo_entidad: BANCOS / FINANCIERAS / CMAC / CRAC / EDPYMES. Si None,
                se intenta inferir del path (.../banca_multiple/... -> BANCOS).
        """
        start = time.perf_counter()
        if tipo_entidad is None:
            tipo_entidad = _infer_tipo_entidad_from_path(path)
            if tipo_entidad is None:
                raise ValidationError(
                    "No pude inferir tipo_entidad del path. Pasa tipo_entidad explicito.",
                    context={"path": str(path)},
                )

        log.info("monthly_eeff.start", path=str(path), tipo_entidad=tipo_entidad)

        sheets = read_xls(path)
        balance_sheets: list[XlsSheet] = []
        resultado_sheets: list[XlsSheet] = []
        for s in sheets:
            kind = _classify_sheet(s)
            if kind == "balance":
                balance_sheets.append(s)
            elif kind == "resultados":
                resultado_sheets.append(s)

        if not balance_sheets and not resultado_sheets:
            raise ValidationError(
                "No se identificaron hojas BG/ER en el archivo",
                context={"file": path.name, "sheets": [s.name for s in sheets]},
            )

        inserted = 0
        errors: list[str] = []

        for sheet in balance_sheets:
            try:
                lookup = await self._get_lookup("balance")
                n = await self._import_sheet(
                    sheet=sheet,
                    tipo_estado="balance",
                    source_file=path.name,
                    tipo_entidad=tipo_entidad,
                    lookup=lookup,
                )
                inserted += n
                log.info("monthly_eeff.sheet_ok", sheet=sheet.name, rows=n)
            except Exception as e:
                errors.append(f"sheet={sheet.name}: {e}")
                log.error("monthly_eeff.sheet_failed", sheet=sheet.name, error=str(e))
                with contextlib.suppress(Exception):
                    await self._conn.rollback()

        for sheet in resultado_sheets:
            try:
                lookup = await self._get_lookup("resultados")
                n = await self._import_sheet(
                    sheet=sheet,
                    tipo_estado="resultados",
                    source_file=path.name,
                    tipo_entidad=tipo_entidad,
                    lookup=lookup,
                )
                inserted += n
                log.info("monthly_eeff.sheet_ok", sheet=sheet.name, rows=n)
            except Exception as e:
                errors.append(f"sheet={sheet.name}: {e}")
                log.error("monthly_eeff.sheet_failed", sheet=sheet.name, error=str(e))
                with contextlib.suppress(Exception):
                    await self._conn.rollback()

        return ImportResult(
            source="monthly_eeff",
            source_file=path.name,
            rows_inserted=inserted,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )

    async def _get_lookup(self, tipo_estado: str) -> _CuentaLookup:
        cached = self._lookup_cache.get(tipo_estado)
        if cached:
            return cached
        lookup = await _CuentaLookup.from_db(self._conn, tipo_estado=tipo_estado)
        self._lookup_cache[tipo_estado] = lookup
        return lookup

    async def _import_sheet(
        self,
        *,
        sheet: XlsSheet,
        tipo_estado: str,
        source_file: str,
        tipo_entidad: str,
        lookup: _CuentaLookup,
    ) -> int:
        layout = _detect_layout(sheet)
        if not layout.entidades:
            log.warning("monthly_eeff.no_entities", sheet=sheet.name)
            return 0

        log.info(
            "monthly_eeff.layout",
            sheet=sheet.name,
            entidades=len(layout.entidades),
            fecha_cierre=str(layout.fecha_cierre),
            data_start_row=layout.data_start_row,
        )

        observations: list[tuple] = []
        # Section tracker: en balance "Activo" -> A, "Pasivo" -> B, "Patrimonio" -> C.
        # En resultados no hay secciones canonicas (todo bajo prefix "").
        current_section: str = "A" if tipo_estado == "balance" else ""
        # Default parent: en Patrimonio (C), las cuentas son hijas directas de C
        # (no hay headers L2 intermedios como en Activo/Pasivo).
        current_parent_codigo: str | None = current_section if current_section else None

        _section_markers = {
            "activo": "A",
            "pasivo": "B",
            "patrimonio": "C",
            "patrimonio neto": "C",
        }
        # Markers que NO son cuentas (totales, headers de resumen)
        _skip_markers = {
            "total activo",
            "total pasivo",
            "total pasivo y patrimonio",
            "total patrimonio",
            "contingentes",
            "cuentas contingentes",
            "cuentas de orden",
        }

        for r in range(layout.data_start_row, sheet.n_rows):
            nombre_raw = _cell_str(sheet, r, 0)
            if not nombre_raw:
                continue
            nombre_norm = _normalize(nombre_raw)

            # Skipear filas de totales y marcadores no-cuenta
            if nombre_norm in _skip_markers:
                continue

            # Actualizar seccion actual si esta fila es un marker (Activo/Pasivo/Patrimonio)
            if tipo_estado == "balance" and nombre_norm in _section_markers:
                current_section = _section_markers[nombre_norm]
                # En Patrimonio (C) las cuentas son hijas directas de C; en
                # Activo (A) / Pasivo (B) hay headers L2 (A1, A2, B1, B2...) intermedios.
                current_parent_codigo = current_section if current_section == "C" else None
                continue

            # Detector de header: las cabeceras SBS estan TODAS en mayusculas.
            es_header = nombre_raw.strip() == nombre_raw.strip().upper()

            codigo: str | None = None
            cuenta_nombre_canonico: str | None = None
            if es_header:
                resolved = lookup.find_header(current_section, nombre_norm)
                if resolved:
                    codigo, cuenta_nombre_canonico = resolved
                    current_parent_codigo = codigo
            elif current_parent_codigo:
                resolved = lookup.find_child(current_parent_codigo, nombre_norm)
                if resolved:
                    codigo, cuenta_nombre_canonico = resolved

            if not codigo:
                continue

            for entidad_info in layout.entidades:
                # Recolectar valores por moneda
                vals_by_moneda: dict[str, float] = {}
                for moneda, col_idx in entidad_info.monedas.items():
                    raw_val = sheet.cell(r, col_idx)
                    v = _coerce_number(raw_val)
                    if v is not None:
                        vals_by_moneda[moneda] = v

                # Si no hay TOTAL pero si MN y ME -> calcularlo (BANCOS no trae TOTAL)
                if (
                    "TOTAL" not in vals_by_moneda
                    and "MN" in vals_by_moneda
                    and "ME" in vals_by_moneda
                ):
                    vals_by_moneda["TOTAL"] = vals_by_moneda["MN"] + vals_by_moneda["ME"]

                for moneda, valor in vals_by_moneda.items():
                    observations.append(
                        (
                            layout.periodo_yyyymm,
                            layout.fecha_cierre,
                            tipo_estado,
                            None,  # empresa_sbs (no disponible)
                            entidad_info.nombre,
                            tipo_entidad,
                            None,  # microfinanciera (no disponible)
                            None,  # nacional (no disponible)
                            moneda,
                            codigo,
                            cuenta_nombre_canonico or nombre_raw,
                            valor,
                            source_file,
                        )
                    )

        # Dedup en memoria por (entidad, moneda, codigo): si por fuzzy match
        # multiples filas resolvieron al mismo codigo, conservar la primera
        # (que es la mas confiable porque aparece antes en el archivo SBS).
        seen: set[tuple] = set()
        deduped: list[tuple] = []
        for obs in observations:
            # obs = (periodo, fecha, tipo_estado, empresa_sbs, nomb_correg, ...)
            # key = (nomb_correg=4, moneda=8, codigo=9)
            key = (obs[4], obs[8], obs[9])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(obs)

        # Volcar en batches
        inserted = 0
        for i in range(0, len(deduped), self._batch_size):
            batch = deduped[i : i + self._batch_size]
            inserted += await self._copy_batch(batch)
        return inserted

    async def _copy_batch(self, batch: list[tuple]) -> int:
        with contextlib.suppress(Exception):
            await self._conn.rollback()

        async with self._conn.cursor() as cur:
            await cur.execute("DROP TABLE IF EXISTS _eeff_stage")
            await cur.execute(
                """
                CREATE TEMPORARY TABLE _eeff_stage (
                    periodo INT, fecha_cierre DATE, tipo_estado TEXT,
                    empresa_sbs TEXT, nomb_correg TEXT, tipo_entidad TEXT,
                    microfinanciera TEXT, nacional TEXT,
                    moneda TEXT, cuenta_codigo TEXT, cuenta_nombre TEXT,
                    valor NUMERIC(20, 4), source_file TEXT
                )
                """
            )

            async with cur.copy(
                "COPY _eeff_stage "
                "(periodo, fecha_cierre, tipo_estado, empresa_sbs, nomb_correg, "
                "tipo_entidad, microfinanciera, nacional, moneda, "
                "cuenta_codigo, cuenta_nombre, valor, source_file) "
                "FROM STDIN"
            ) as copy:
                for row in batch:
                    await copy.write_row(row)

            await cur.execute(
                """
                INSERT INTO raw.eeff_observacion (
                    periodo, fecha_cierre, tipo_estado,
                    empresa_sbs, nomb_correg, tipo_entidad, microfinanciera, nacional,
                    moneda, cuenta_codigo, cuenta_nombre, valor,
                    source, source_file
                )
                SELECT periodo, fecha_cierre, tipo_estado,
                       empresa_sbs, nomb_correg, tipo_entidad, microfinanciera, nacional,
                       moneda, cuenta_codigo, cuenta_nombre, valor,
                       'monthly_eeff', source_file
                FROM _eeff_stage
                ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo)
                DO UPDATE SET
                    valor       = EXCLUDED.valor,
                    loaded_at   = now()
                """
            )
            n = cur.rowcount
            await cur.execute("DROP TABLE IF EXISTS _eeff_stage")

        await self._conn.commit()
        return n


# ============================================================================
# Layout detection
# ============================================================================


class _EntidadInfo:
    __slots__ = ("monedas", "nombre")

    def __init__(self, nombre: str, monedas: dict[str, int]) -> None:
        self.nombre = nombre
        self.monedas = monedas


class _Layout:
    __slots__ = ("data_start_row", "entidades", "fecha_cierre", "periodo_yyyymm")

    def __init__(
        self,
        fecha_cierre: date,
        periodo_yyyymm: int,
        entidades: list[_EntidadInfo],
        data_start_row: int,
    ) -> None:
        self.fecha_cierre = fecha_cierre
        self.periodo_yyyymm = periodo_yyyymm
        self.entidades = entidades
        self.data_start_row = data_start_row


def _detect_layout(sheet: XlsSheet) -> _Layout:
    """Detecta fecha + entidades + monedas + data_start_row.

    Strategy robusta para tolerar las 2 convenciones SBS:
    - CMAC/CRAC/EDPYME: entidades en row 5, monedas en row 6, data desde row 8
    - BANCOS/FINANCIERAS: entidades en row 6, monedas en row 7, data desde row 9

    Busca dinamicamente la fila de monedas (la que tiene >=3 celdas MN/ME[/TOTAL]),
    la fila de entidades es la inmediatamente anterior, y data_start_row es la
    primera fila no vacia despues de la fila de monedas.
    """
    fecha_cierre: date | None = None
    for r in range(0, 7):
        for c in range(0, 6):
            d = _coerce_date(sheet.cell(r, c))
            if d:
                fecha_cierre = d
                break
        if fecha_cierre:
            break
    if fecha_cierre is None:
        raise ValidationError("No se pudo detectar fecha de cierre en el archivo")

    periodo_yyyymm = fecha_cierre.year * 100 + fecha_cierre.month

    # Localizar fila de monedas: la primera fila (rows 5-8) cuya col 1 sea "MN"
    monedas_row = -1
    for candidate in range(4, 10):
        v = _cell_str(sheet, candidate, 1)
        if v and v.upper() == "MN":
            monedas_row = candidate
            break
    if monedas_row < 0:
        raise ValidationError("No se pudo detectar fila de monedas (MN/ME)")

    entidades_row = monedas_row - 1
    data_start_row = monedas_row + 1

    # Saltar filas vacias entre monedas y primera cuenta
    while data_start_row < sheet.n_rows and not _cell_str(sheet, data_start_row, 0):
        data_start_row += 1

    # Detectar entidades. Cada entidad ocupa N columnas consecutivas con monedas
    # MN/ME/[TOTAL]. Iteramos col 1+ buscando cells no vacios en entidades_row.
    # Headers como "Activo" se repiten cada N entidades (separadores visuales);
    # los descartamos con un set de stopwords.
    entidades: list[_EntidadInfo] = []
    vistos: set[str] = set()
    stopwords = {"activo", "pasivo", "patrimonio", "mn", "me", "total"}
    n_cols = sheet.n_cols
    col = 1
    while col < n_cols:
        nombre = _cell_str(sheet, entidades_row, col)
        if not nombre or nombre.lower() in stopwords:
            col += 1
            continue
        # Para esta entidad, asignar columnas contiguas que tengan moneda
        monedas: dict[str, int] = {}
        scan = col
        while scan < n_cols and scan < col + 5:
            m = _cell_str(sheet, monedas_row, scan)
            if m and m.upper() in ("MN", "ME", "TOTAL"):
                monedas[m.upper()] = scan
                scan += 1
            else:
                break
        if len(monedas) >= 2 and nombre not in vistos:
            entidades.append(_EntidadInfo(nombre=nombre, monedas=monedas))
            vistos.add(nombre)
            col = scan + 1
        else:
            col += 1

    return _Layout(
        fecha_cierre=fecha_cierre,
        periodo_yyyymm=periodo_yyyymm,
        entidades=entidades,
        data_start_row=data_start_row,
    )


# ============================================================================
# Cuenta lookup
# ============================================================================


class _CuentaLookup:
    """Index de dim_cuenta para resolver nombres a codigos durante el parse.

    El balance tiene 3 secciones canonicas con prefijo distinto:
      - A* = Activo
      - B* = Pasivo
      - C* = Patrimonio

    El mismo nombre puede aparecer en >1 seccion (ej "FONDOS INTERBANCARIOS"
    aparece como A2 en Activo y B3 en Pasivo). Por eso indexamos por
    (section_prefix, nombre_norm).

    En resultados (donde no hay secciones canonicas equivalentes) el prefix
    suele ser vacio o "" y todas las cuentas se indexan con el mismo prefix.
    """

    def __init__(self) -> None:
        # (section_prefix, nombre_norm) -> (codigo, nombre_canonico) para headers
        self._header: dict[tuple[str, str], tuple[str, str]] = {}
        # (parent_codigo, nombre_norm) -> (codigo, nombre_canonico) para hijos
        self._child_by_parent_name: dict[tuple[str, str], tuple[str, str]] = {}

    @classmethod
    async def from_db(
        cls,
        conn: psycopg.AsyncConnection,
        *,
        tipo_estado: str,
    ) -> _CuentaLookup:
        instance = cls()
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT codigo, nombre, nivel, parent_codigo
                FROM dw.dim_cuenta
                WHERE tipo_estado = %s
                """,
                (tipo_estado,),
            )
            rows = await cur.fetchall()
        await conn.commit()

        for codigo, nombre, nivel, parent_codigo in rows:
            nombre_norm = _normalize(nombre)
            section = _section_prefix(codigo)

            is_header = nivel <= 2 and (
                parent_codigo is None or len(parent_codigo) <= 1  # 'A', 'B', 'C', '1', '2', ...
            )
            if is_header:
                instance._header[(section, nombre_norm)] = (codigo, nombre)

        for codigo, nombre, nivel, parent_codigo in rows:
            if nivel < 2 or not parent_codigo:
                continue
            nombre_norm = _normalize(nombre)
            instance._child_by_parent_name[(parent_codigo, nombre_norm)] = (codigo, nombre)
            grand_parent = (
                parent_codigo.rsplit(".", 1)[0] if "." in parent_codigo else parent_codigo
            )
            if grand_parent != parent_codigo:
                instance._child_by_parent_name.setdefault(
                    (grand_parent, nombre_norm), (codigo, nombre)
                )
        return instance

    def find_header(self, section: str, nombre_norm: str) -> tuple[str, str] | None:
        # 1) Match exacto
        exact = self._header.get((section, nombre_norm))
        if exact:
            return exact
        # 2) Match fuzzy por prefix: SBS a veces trunca nombres largos.
        #    Solo se devuelve si hay UN UNICO candidato (sino, ambiguo).
        nombre_palabras = nombre_norm.split()
        if len(nombre_palabras) < 2:
            return None
        candidatos = []
        for (sec, cand_norm), value in self._header.items():
            if sec != section:
                continue
            cand_palabras = cand_norm.split()
            # Las primeras 3 palabras del input deben coincidir EXACTO con las primeras
            # 3 del candidato (o todas si el input es mas corto).
            n_check = min(3, len(nombre_palabras), len(cand_palabras))
            if n_check < 2:
                continue
            if nombre_palabras[:n_check] == cand_palabras[:n_check]:
                candidatos.append(value)
        # Solo devolver si hay UN solo match (sino es ambiguo)
        if len(candidatos) == 1:
            return candidatos[0]
        return None

    def find_child(self, parent_codigo: str, nombre_norm: str) -> tuple[str, str] | None:
        # 1) Exacto
        exact = self._child_by_parent_name.get((parent_codigo, nombre_norm))
        if exact:
            return exact
        # 2) Fuzzy single-match dentro del mismo parent
        nombre_palabras = nombre_norm.split()
        if not nombre_palabras:
            return None
        candidatos = []
        for (parent, cand_norm), value in self._child_by_parent_name.items():
            if parent != parent_codigo:
                continue
            cand_palabras = cand_norm.split()
            n_check = min(2, len(nombre_palabras), len(cand_palabras))
            if n_check < 1:
                continue
            if nombre_palabras[:n_check] == cand_palabras[:n_check]:
                candidatos.append(value)
        if len(candidatos) == 1:
            return candidatos[0]
        return None


def _section_prefix(codigo: str) -> str:
    """Para balance: A/B/C. Para resultados: ''."""
    if not codigo:
        return ""
    first = codigo[0]
    if first in ("A", "B", "C"):
        return first
    return ""


# ============================================================================
# Helpers
# ============================================================================


_PATH_GROUP_TO_TIPO = {
    "banca_multiple": "BANCOS",
    "financiera": "FINANCIERAS",
    "cmac": "CMAC",
    "crac": "CRAC",
    "edpyme": "EDPYMES",
}


def _infer_tipo_entidad_from_path(path: Path) -> str | None:
    """Infiere tipo_entidad inspeccionando los segmentos del path.

    Convencion del scraper: local-data/raw/<grupo>/<topico>/<anio>/<mes>/<file>
    """
    for part in path.parts:
        key = part.lower()
        if key in _PATH_GROUP_TO_TIPO:
            return _PATH_GROUP_TO_TIPO[key]
    return None


def _normalize(s: str) -> str:
    """Normaliza nombres para matching robusto entre grupos SBS.

    Aplica:
    - strip de espacios (BANCOS indenta con '   Caja', CMAC sin indentar)
    - quita asterisco final ('Vigentes*' -> 'Vigentes')
    - colapsa espacios multiples internos
    - quita acentos
    - lowercase
    """
    s = s.strip()
    if s.endswith("*"):
        s = s[:-1].strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _cell_str(sheet: XlsSheet, row: int, col: int) -> str | None:
    if col >= sheet.n_cols or row >= sheet.n_rows:
        return None
    v = sheet.cell(row, col)
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _coerce_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        try:
            return _excel_serial_to_date(float(value))
        except Exception:
            return None
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y"):
            try:
                return datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
    return None


def _excel_serial_to_date(serial: float) -> date:
    epoch = date(1899, 12, 30)
    return epoch + timedelta(days=int(serial))


def _coerce_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip().replace(",", "").replace("\xa0", "")
        if not s or s.startswith("#"):
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None
