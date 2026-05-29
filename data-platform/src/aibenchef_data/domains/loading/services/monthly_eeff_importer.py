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
    # 2009-2015 SBS usa "05-BG (P)" / "05-GyP (P)" / "01-BG", etc.
    if "-bg" in name_lower or name_lower.startswith("bg") or name_lower.endswith("bg"):
        return "balance"
    if "-gyp" in name_lower or "-er" in name_lower or "gyp" in name_lower:
        return "resultados"

    # Heuristica por contenido. Las primeras filas contienen el titulo.
    # Buscamos en cols 0-3 porque algunos layouts viejos lo ponen en col 1.
    for r in range(0, 5):
        for c in range(0, 4):
            v = sheet.cell(r, c)
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
        # Cache para cabecera_maestra: key = (tipo_estado, tipo_entidad)
        self._position_cache: dict[tuple[str, str], _PositionLookup] = {}

    async def import_file(
        self,
        path: Path,
        *,
        tipo_entidad: str | None = None,
        archivo_id: str | None = None,
    ) -> ImportResult:
        """Importa un archivo SBS mensual.

        Args:
            path: Ruta al .xls SBS.
            tipo_entidad: BANCOS / FINANCIERAS / CMAC / CRAC / EDPYMES. Si None,
                se intenta inferir del path (.../banca_multiple/... -> BANCOS).
            archivo_id: UUID de raw.archivos_descargados — se propaga a
                raw.eeff_celda_cruda para trazabilidad. None si el import es
                puntual y el archivo no esta registrado.
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
                    archivo_id=archivo_id,
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
                    archivo_id=archivo_id,
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

    async def _get_position_lookup(
        self, tipo_estado: str, tipo_entidad: str, periodo: int
    ) -> _PositionLookup:
        key = (tipo_estado, tipo_entidad)
        cached = self._position_cache.get(key)
        if cached:
            return cached
        lookup = await _PositionLookup.from_db(
            self._conn,
            tipo_estado=tipo_estado,
            tipo_entidad=tipo_entidad,
            periodo=periodo,
        )
        self._position_cache[key] = lookup
        return lookup

    async def _import_sheet(
        self,
        *,
        sheet: XlsSheet,
        tipo_estado: str,
        source_file: str,
        tipo_entidad: str,
        lookup: _CuentaLookup,
        archivo_id: str | None = None,
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

        # Cargar cabecera_maestra (positional) — None si esta vacia para este grupo.
        position_lookup = await self._get_position_lookup(
            tipo_estado, tipo_entidad, layout.periodo_yyyymm
        )

        observations: list[tuple] = []
        # Celdas crudas — una por (entidad, orden). Se llenan ANTES del resolver
        # de codigos para capturar tambien filas que el parser descarta (issue #65).
        cells_raw: list[tuple] = []
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
        # Headers que CAMBIAN seccion al verlos (no son section markers SBS
        # pero indican que las siguientes filas son de un sector distinto):
        # CONTINGENTES y TOTAL PASIVO Y PATRIMONIO disparan sec=D para que
        # las cuentas D1-D4 se busquen bajo parent='D'.
        _section_trigger_headers = {
            "contingentes": "D",
            "total pasivo y patrimonio": "T",
        }

        # Counter posicional — debe espejar EXACTAMENTE init-maestra: cada fila
        # no-vacia que no sea section marker (Activo/Pasivo/Patrimonio).
        orden = 0

        for r in range(layout.data_start_row, sheet.n_rows):
            nombre_raw = _cell_str(sheet, r, layout.nombre_col)
            if not nombre_raw:
                continue
            nombre_norm = _normalize(nombre_raw)

            # Section markers actualizan tracker pero no cuentan orden
            if tipo_estado == "balance" and nombre_norm in _section_markers:
                current_section = _section_markers[nombre_norm]
                current_parent_codigo = current_section if current_section == "C" else None
                continue

            orden += 1

            # Detector de header: las cabeceras SBS estan TODAS en mayusculas.
            es_header = nombre_raw.strip() == nombre_raw.strip().upper()

            codigo: str | None = None
            cuenta_nombre_canonico: str | None = None

            # FIX issue #15: detectar footnotes EXTRA (no en cabecera_maestra)
            # ANTES de mirar position_lookup. Si la fila parece anotacion
            # SBS variable por periodo ("* Mediante Resolucion SBS N° ..."),
            # decrementar orden y skip para mantener sincronia con cabecera.
            #
            # Importante: hacer ANTES de position_lookup.has() porque cabecera
            # puede tener un NULL entry en este orden con OTRO nombre. Si
            # confiamos solo en position_lookup, el offset entre archivo real
            # y cabecera se acumula silenciosamente.
            if _is_annotation_or_footnote_extra(nombre_raw):
                orden -= 1
                continue

            # ESTRATEGIA (refactor issue #42 - cuentas faltantes por entidad):
            # 1) NAME-BASED PRIMARIO: la cabecera_maestra positional es fragil
            #    cuando un archivo SBS varia su estructura entre entidades del
            #    mismo grupo (ej. CMAC Arequipa abril 2020 no tiene la fila
            #    "Tarjetas de Crédito" que sí esta en cabecera CMAC, causando
            #    drift +1 en todos los codigos a partir de ese orden).
            #
            #    Resolver por NOMBRE (con parent tracking) es robusto ante
            #    estos huecos porque cada cuenta se identifica por su nombre
            #    canonico, no por la posicion relativa.
            #
            # 2) POSITION como FALLBACK: si name-based falla (cuenta SBS con
            #    typo no contemplado en aliases, o nombre nuevo), confiamos
            #    en cabecera. Codigo NULL en cabecera = fila conocida no-
            #    cuenta -> skip.
            # Pre-check: trigger headers cambian la seccion ANTES de hacer
            # name lookup (CONTINGENTES dispara seccion D; TOTAL PASIVO Y
            # PATRIMONIO dispara T). Sin esto, find_header("C","contingentes")
            # falla porque cabecera tiene CONTINGENTES bajo section D.
            trigger_section = _section_trigger_headers.get(nombre_norm)
            if trigger_section and es_header:
                current_section = trigger_section
                current_parent_codigo = trigger_section

            name_codigo: str | None = None
            name_nombre: str | None = None
            if es_header:
                resolved = lookup.find_header(current_section, nombre_norm)
                if resolved:
                    name_codigo, name_nombre = resolved
            elif current_parent_codigo:
                resolved = lookup.find_child(current_parent_codigo, nombre_norm)
                if resolved:
                    name_codigo, name_nombre = resolved

            if name_codigo:
                codigo = name_codigo
                cuenta_nombre_canonico = name_nombre
                if es_header:
                    current_parent_codigo = codigo
            elif position_lookup.has(orden):
                # Fallback a position. NULL => skip conocido.
                pos_codigo = position_lookup.get_codigo(orden)
                if pos_codigo is None:
                    continue
                codigo = pos_codigo
                cuenta_nombre_canonico = position_lookup.get_nombre(orden)
                if es_header:
                    current_parent_codigo = codigo

            # Captura de celdas crudas — corre para TODAS las entidades del layout,
            # incluso si codigo no resolvio. Es justamente la senal que el inspector
            # usa para mostrar "fila en archivo sin codigo en cabecera".
            for entidad_info in layout.entidades:
                vals_raw: dict[str, float] = {}
                for moneda, col_idx in entidad_info.monedas.items():
                    raw_val = sheet.cell(r, col_idx)
                    v = _coerce_number(raw_val)
                    if v is not None:
                        vals_raw[moneda] = v

                # Solo guardar la fila si tiene al menos UN valor — filas
                # totalmente vacias (todas las celdas blancas) no aportan
                # informacion al inspector y solo inflan la tabla.
                if vals_raw:
                    cells_raw.append(
                        (
                            layout.periodo_yyyymm,
                            entidad_info.nombre,
                            tipo_entidad,
                            tipo_estado,
                            orden,
                            es_header,
                            nombre_raw.strip(),
                            vals_raw.get("MN"),
                            vals_raw.get("ME"),
                            vals_raw.get("TOTAL"),  # NULL si SBS no lo publica
                            archivo_id,
                            source_file,
                            codigo,  # V114: NULL si parser no resolvio — JOIN por codigo en inspector
                        )
                    )

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

        # Dedup celdas crudas por (entidad, orden) — orden es unico por fila SBS
        # y el unique constraint de la tabla lo refuerza. Conservamos la primera.
        seen_raw: set[tuple] = set()
        deduped_raw: list[tuple] = []
        for cell in cells_raw:
            # cell = (periodo, nomb_correg=1, tipo_entidad, tipo_estado=3, orden=4, ...)
            key_raw = (cell[1], cell[3], cell[4])
            if key_raw in seen_raw:
                continue
            seen_raw.add(key_raw)
            deduped_raw.append(cell)

        # Volcar en batches
        inserted = 0
        for i in range(0, len(deduped), self._batch_size):
            batch = deduped[i : i + self._batch_size]
            inserted += await self._copy_batch(batch)

        # Volcar celdas crudas (issue #65). No suma al rows_inserted del
        # importer porque es metadata para el inspector, no data del cubo.
        for i in range(0, len(deduped_raw), self._batch_size):
            batch_raw = deduped_raw[i : i + self._batch_size]
            await self._copy_batch_celdas(batch_raw)

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
                       empresa_sbs,
                       dw.normalizar_entidad(nomb_correg),
                       tipo_entidad, microfinanciera, nacional,
                       moneda, cuenta_codigo, cuenta_nombre, valor,
                       'monthly_eeff', source_file
                FROM _eeff_stage
                ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo)
                DO UPDATE SET
                    valor       = EXCLUDED.valor,
                    source      = EXCLUDED.source,
                    source_file = EXCLUDED.source_file,
                    loaded_at   = now()
                """
            )
            n = cur.rowcount
            await cur.execute("DROP TABLE IF EXISTS _eeff_stage")

        await self._conn.commit()
        return n

    async def _copy_batch_celdas(self, batch: list[tuple]) -> int:
        """Volcado de celdas crudas a raw.eeff_celda_cruda (issue #65).

        UPSERT por (periodo, nomb_correg, tipo_estado, orden). El nomb_correg se
        normaliza con dw.normalizar_entidad para mantener consistencia con
        raw.eeff_observacion (sino el LEFT JOIN del inspector no matchea
        cuando el entidad tiene footnote marker).
        """
        if not batch:
            return 0
        with contextlib.suppress(Exception):
            await self._conn.rollback()

        async with self._conn.cursor() as cur:
            await cur.execute("DROP TABLE IF EXISTS _eeff_celda_stage")
            await cur.execute(
                """
                CREATE TEMPORARY TABLE _eeff_celda_stage (
                    periodo INT, nomb_correg TEXT, tipo_entidad TEXT,
                    tipo_estado TEXT, orden INT, es_header BOOLEAN,
                    nombre_archivo TEXT,
                    valor_mn NUMERIC(20, 4), valor_me NUMERIC(20, 4),
                    valor_total NUMERIC(20, 4),
                    archivo_id UUID, source_file TEXT,
                    cuenta_codigo TEXT
                )
                """
            )

            async with cur.copy(
                "COPY _eeff_celda_stage "
                "(periodo, nomb_correg, tipo_entidad, tipo_estado, orden, "
                "es_header, nombre_archivo, valor_mn, valor_me, valor_total, "
                "archivo_id, source_file, cuenta_codigo) "
                "FROM STDIN"
            ) as copy:
                for row in batch:
                    await copy.write_row(row)

            await cur.execute(
                """
                INSERT INTO raw.eeff_celda_cruda (
                    periodo, nomb_correg, tipo_entidad, tipo_estado, orden,
                    es_header, nombre_archivo, valor_mn, valor_me, valor_total,
                    archivo_id, source_file, cuenta_codigo
                )
                SELECT periodo,
                       dw.normalizar_entidad(nomb_correg),
                       tipo_entidad, tipo_estado, orden,
                       es_header, nombre_archivo, valor_mn, valor_me, valor_total,
                       archivo_id, source_file, cuenta_codigo
                FROM _eeff_celda_stage
                ON CONFLICT (periodo, nomb_correg, tipo_estado, orden)
                DO UPDATE SET
                    nombre_archivo = EXCLUDED.nombre_archivo,
                    valor_mn       = EXCLUDED.valor_mn,
                    valor_me       = EXCLUDED.valor_me,
                    valor_total    = EXCLUDED.valor_total,
                    es_header      = EXCLUDED.es_header,
                    archivo_id     = EXCLUDED.archivo_id,
                    source_file    = EXCLUDED.source_file,
                    cuenta_codigo  = EXCLUDED.cuenta_codigo,
                    imported_at    = now()
                """
            )
            n = cur.rowcount
            await cur.execute("DROP TABLE IF EXISTS _eeff_celda_stage")

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
    __slots__ = ("data_start_row", "entidades", "fecha_cierre", "nombre_col", "periodo_yyyymm")

    def __init__(
        self,
        fecha_cierre: date,
        periodo_yyyymm: int,
        entidades: list[_EntidadInfo],
        data_start_row: int,
        nombre_col: int = 0,
    ) -> None:
        self.fecha_cierre = fecha_cierre
        self.periodo_yyyymm = periodo_yyyymm
        self.entidades = entidades
        self.data_start_row = data_start_row
        # 0 = layout moderno (cuentas en col 0). 1 = layout BANCOS/FINANCIERAS
        # 2010-2012 (col 0 vacia, cuentas en col 1).
        self.nombre_col = nombre_col


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

    # Localizar fila de monedas: la primera fila (rows 4-10) donde alguna celda
    # de las primeras 6 cols sea "MN". El layout moderno tiene MN en col 1; el
    # layout 2009-2015 BANCOS/FINANCIERAS tiene MN en col 2 (col 1 es cuentas).
    monedas_row = -1
    for candidate in range(4, 10):
        for c_try in range(1, 6):
            v = _cell_str(sheet, candidate, c_try)
            if v and v.upper() == "MN":
                monedas_row = candidate
                break
        if monedas_row >= 0:
            break
    if monedas_row < 0:
        raise ValidationError("No se pudo detectar fila de monedas (MN/ME)")

    entidades_row = monedas_row - 1
    data_start_row = monedas_row + 1

    # Detectar la columna donde estan los NOMBRES de cuenta. Layout moderno
    # tiene cuentas en col 0; layout BANCOS/FINANCIERAS 2010-2012 tiene col 0
    # vacia y cuentas en col 1. Probamos col 0 primero, sino col 1.
    nombre_col = 0
    test_rows_with_content_col_0 = sum(
        1
        for r in range(data_start_row, min(data_start_row + 20, sheet.n_rows))
        if _cell_str(sheet, r, 0)
    )
    test_rows_with_content_col_1 = sum(
        1
        for r in range(data_start_row, min(data_start_row + 20, sheet.n_rows))
        if _cell_str(sheet, r, 1)
    )
    if test_rows_with_content_col_0 == 0 and test_rows_with_content_col_1 > 0:
        nombre_col = 1

    # Saltar filas vacias entre monedas y primera cuenta (chequea col elegida)
    while data_start_row < sheet.n_rows and not _cell_str(sheet, data_start_row, nombre_col):
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
            # Normalizar footnote markers SBS (ej. "CMAC Arequipa (*)" -> "CMAC Arequipa")
            # para que el Inspector encuentre las mismas entidades entre periodos.
            nombre_norm_entity = re.sub(r"\s*\(\*+\)\s*$", "", nombre).strip()
            nombre_norm_entity = re.sub(r"\s*\*+\s+.*$", "", nombre_norm_entity).strip()
            entidades.append(_EntidadInfo(nombre=nombre_norm_entity, monedas=monedas))
            vistos.add(nombre)
            col = scan + 1
        else:
            col += 1

    return _Layout(
        fecha_cierre=fecha_cierre,
        periodo_yyyymm=periodo_yyyymm,
        entidades=entidades,
        data_start_row=data_start_row,
        nombre_col=nombre_col,
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
            # Cargar aliases manuales: nombre_norm -> codigo
            await cur.execute(
                """
                SELECT alias_norm, codigo, seccion
                FROM dw.cuenta_alias
                WHERE tipo_estado = %s
                """,
                (tipo_estado,),
            )
            alias_rows = await cur.fetchall()
        await conn.commit()
        # Index de aliases: (seccion, alias_norm) -> codigo
        instance._aliases: dict[tuple[str, str], str] = {
            (a_sec or "", a_norm): a_codigo for a_norm, a_codigo, a_sec in alias_rows
        }
        # Tambien necesitamos el nombre canonical correspondiente al codigo
        instance._codigo_to_nombre: dict[str, str] = {}

        for codigo, nombre, nivel, parent_codigo in rows:
            nombre_norm = _normalize(nombre)
            section = _section_prefix(codigo)
            instance._codigo_to_nombre[codigo] = nombre

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

        # ENRIQUECER lookup con cabecera_maestra (issue #42 - parser refactor).
        #
        # dim_cuenta NO tiene los codigos agregados (B=TOTAL PASIVO, T=TOTAL
        # PASIVO Y PATRIMONIO, D=CONTINGENTES, D1-D4 contingentes específicos).
        # Esos viven en cabecera_maestra. Sin esto, find_header/find_child
        # devuelven None para TOTAL PASIVO, CONTINGENTES, etc., y el parser
        # cae a position_lookup que es fragil cuando el archivo SBS tiene
        # estructura distinta de la cabecera (caso CMAC sin "Tarjetas de
        # Crédito" → offset acumulado +1 en todos los codigos).
        #
        # Cabecera_maestra esta tipificada por (tipo_estado, tipo_entidad);
        # acumulamos todas las entidades porque los codigos agregados son
        # consistentes entre grupos. Si hay duplicado, setdefault preserva
        # la primera entrada.
        async with conn.cursor() as cur2:
            # Leemos tanto cabecera VIGENTE (valido_hasta IS NULL) como
            # LEGACY (valido_hasta != NULL, ej. pre-2013). ORDER BY
            # valido_hasta IS NULL DESC garantiza que vigente entra
            # primero; el `setdefault` mas abajo preserva la vigente
            # cuando el nombre normalizado colisiona.
            # Subquery con DISTINCT ON para tomar la vigente cuando hay
            # multiples versiones del mismo codigo. ORDER BY garantiza
            # que valido_hasta IS NULL (vigente) gana sobre las legacy.
            await cur2.execute(
                """
                SELECT codigo, nombre, es_h, es_tot
                  FROM (
                       SELECT DISTINCT ON (codigo, nombre)
                              codigo,
                              nombre,
                              COALESCE(es_header, false) AS es_h,
                              COALESCE(es_total, false) AS es_tot,
                              (CASE WHEN valido_hasta IS NULL THEN 0 ELSE 1 END) AS prio
                         FROM dw.cabecera_maestra
                        WHERE tipo_estado = %s
                          AND codigo IS NOT NULL
                        ORDER BY codigo, nombre, prio
                  ) t
                """,
                (tipo_estado,),
            )
            cabecera_rows = await cur2.fetchall()
        await conn.commit()

        for codigo, nombre, _es_h, _es_tot in cabecera_rows:
            if not nombre:
                continue
            nombre_norm = _normalize(nombre)
            section = _section_prefix(codigo)
            instance._codigo_to_nombre.setdefault(codigo, nombre)

            # Top-level header: codigo de un solo char (A, B, C, D, T).
            # Sub-cuentas (A1, B1.1, D1, etc.) son children de su seccion/parent.
            if len(codigo) == 1:
                instance._header.setdefault((section, nombre_norm), (codigo, nombre))
                continue

            # Sub-cuentas. Inferir parent:
            #   - "B1.1" -> parent "B1"
            #   - "A4.1.3" -> parent "A4.1"
            #   - "D1" -> parent "D" (sin punto, el primer char es la seccion)
            #   - "B10" -> parent "B" (digit sin punto -> seccion como parent)
            if "." in codigo:
                parent = codigo.rsplit(".", 1)[0]
            else:
                # Codigo tipo "B10" o "D1" — el parent es la seccion (primer char)
                parent = section if section else codigo[0]

            # Tambien registrar como header secundario en la seccion si es es_header
            # (ej. A1, B1, C1 son headers pero tambien sub-cuentas de su seccion).
            if _es_h:
                instance._header.setdefault((section, nombre_norm), (codigo, nombre))

            instance._child_by_parent_name.setdefault((parent, nombre_norm), (codigo, nombre))

        return instance

    def find_header(self, section: str, nombre_norm: str) -> tuple[str, str] | None:
        # BUG issue #65: V108 generó aliases automaticos desde "file variants"
        # que apuntan a codigos NO-header (ej "disponible" -> A6.1 sub-cuenta
        # de Activos Fijos). Cuando el parser ve "DISPONIBLE" (header L2 en
        # mayusculas), normaliza a "disponible" y si el alias gana primero,
        # asigna A6.1 en vez del header correcto A1.
        #
        # Fix: match exacto PRIMERO (que apunta a codigo header legitimo segun
        # dim_cuenta + cabecera_maestra), alias como FALLBACK cuando no hay
        # match exacto. Asi aliases solo aplican para nombres renombrados que
        # SBS realmente publica con variantes raras.

        # 1) Match exacto (codigo header legitimo)
        exact = self._header.get((section, nombre_norm))
        if exact:
            return exact
        # 2) Alias manual (dw.cuenta_alias) — fallback para nombres renombrados
        alias_codigo = self._aliases.get((section, nombre_norm)) or self._aliases.get(
            ("", nombre_norm)
        )
        if alias_codigo:
            nombre = self._codigo_to_nombre.get(alias_codigo, "")
            return (alias_codigo, nombre)
        # 3) Match fuzzy por prefix: SBS a veces trunca nombres largos.
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
        # BUG issue #65: alias gana sobre exact match → nombres ambiguos
        # ("Depósitos de Ahorros" existe bajo B1 = B1.2 y bajo B2 = B2.2) se
        # asignan SIEMPRE al codigo del alias (B1.2) ignorando el parent
        # tracker actual. Resultado: parser bajo B2 retorna B1.2 (mal) y B2.2
        # queda sin asignar.
        #
        # Orden de prioridad para preservar jerarquia parent-aware:
        #   1. Exact match scoped a parent (mismo nombre bajo parent actual)
        #   2. Fuzzy match scoped a parent (tolera typos SBS, ej "Ahorro" vs "Ahorros")
        #   3. Alias manual (ultimo recurso, ignora parent — para renombres SBS reales)

        # 1) Match exacto bajo el parent actual (respeta jerarquia SBS)
        exact = self._child_by_parent_name.get((parent_codigo, nombre_norm))
        if exact:
            return exact

        # 2) Fuzzy match dentro del mismo parent (typos SBS).
        # Comparar primeras 2 palabras (o todas si nombre mas corto).
        nombre_palabras = nombre_norm.split()
        if nombre_palabras:
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

        # 3) Alias manual (dw.cuenta_alias) — fallback global SOLO si exact + fuzzy
        # bajo parent no resolvieron. Util para nombres que SBS renombra a algo
        # que no aparece en cabecera_maestra del parent actual.
        seccion = _section_prefix(parent_codigo)
        alias_codigo = self._aliases.get((seccion, nombre_norm)) or self._aliases.get(
            ("", nombre_norm)
        )
        if alias_codigo:
            nombre = self._codigo_to_nombre.get(alias_codigo, "")
            return (alias_codigo, nombre)
        return None


class _PositionLookup:
    """Index de dw.cabecera_maestra para resolver (orden) -> (codigo, nombre).

    Replica el approach historico de la macro Excel de Gus: matching por
    POSICION en lugar de nombre. Robusto ante renames sutiles de SBS.

    NULL codigo significa "fila conocida no-cuenta" (total, footnote,
    contingente). El importer salta esas filas.
    """

    __slots__ = ("_by_orden",)

    def __init__(self) -> None:
        # orden -> (codigo | None, nombre)
        self._by_orden: dict[int, tuple[str | None, str]] = {}

    @classmethod
    async def from_db(
        cls,
        conn: psycopg.AsyncConnection,
        *,
        tipo_estado: str,
        tipo_entidad: str,
        periodo: int,
    ) -> _PositionLookup:
        instance = cls()
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT orden, codigo, nombre
                FROM dw.cabecera_maestra
                WHERE tipo_estado  = %s
                  AND tipo_entidad = %s
                  AND valido_desde <= %s
                  AND (valido_hasta IS NULL OR valido_hasta >= %s)
                """,
                (tipo_estado, tipo_entidad, periodo, periodo),
            )
            for orden, codigo, nombre in await cur.fetchall():
                instance._by_orden[orden] = (codigo, nombre)
        await conn.commit()
        return instance

    def has(self, orden: int) -> bool:
        return orden in self._by_orden

    def get_codigo(self, orden: int) -> str | None:
        entry = self._by_orden.get(orden)
        return entry[0] if entry else None

    def get_nombre(self, orden: int) -> str | None:
        entry = self._by_orden.get(orden)
        return entry[1] if entry else None

    def is_empty(self) -> bool:
        return not self._by_orden


def _section_prefix(codigo: str) -> str:
    """Para balance: A/B/C/D/T. Para resultados: ''.

    D = CONTINGENTES (seccion adicional al balance contable).
    T = TOTAL PASIVO Y PATRIMONIO (gran total).
    """
    if not codigo:
        return ""
    first = codigo[0]
    if first in ("A", "B", "C", "D", "T"):
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


def _is_annotation_or_footnote_extra(nombre_raw: str) -> bool:
    """Detecta filas EXTRA que no están en cabecera_maestra y deben skipearse
    sin contar como orden — son anotaciones/footnotes/metadata que SBS publica
    inconsistentemente entre periodos.

    Esta funcion debe llamarse ANTES de consultar position_lookup, porque
    cabecera_maestra puede tener un NULL entry en el orden actual con OTRO
    nombre (causando misalignment silencioso si confiamos solo en posicional).

    Patrones detectados:

    Issue #15 (original):
    - "* Mediante Resolución SBS N° ...": notas al pie con texto variable por año.
    - "** Mediante Resolución..." (variant).
    - Numerated footnotes "1/", "2/" cuando NO están en cabecera para ese orden.

    Issue #42 (auditor F1 v2, 2009-2026):
    - Excel serial date como header: "40543.0", "42400.0" (cell type "date"
      reportada como número crudo).
    - ISO datetime: "2018-01-31 00:00:00" — fecha del periodo como header.
    - "Tipo de Cambio Contable: S/ X,XXX" — cabecera de TC variable por mes.
    - "Balance General por ..." — title de la hoja que SBS a veces incluye
      en la primera fila de data.
    - "Estado de Ganancias y Pérdidas por ..." — idem para GyP.
    - "(En miles de soles)" / "(En miles de nuevos soles)" — unit note.
    - "Actualizado al/el DD-MM-YYYY" — fecha de publicacion.
    - "(*) Con relacion a ..." / "(*) Con relación a ..." — footnotes
      parentizadas con texto variable (caso CMAC Arequipa / CRAC Luren).
    """
    n = nombre_raw.strip()
    if not n:
        return False

    # Notas SBS de resoluciones (cabecera del documento publicado)
    if n.startswith(("*", "**")):
        return True

    # Footnote numerada "N/ ..." (ej. "1/ Incluye...", "2/ Las cifras...")
    if re.match(r"^\d+/\s", n):
        return True

    # Footnote parentizada "(*) Con relacion a ..." — texto variable de SBS
    # describiendo casos especiales (CRAC Luren -> CMAC Arequipa, etc).
    # Usamos la version normalizada (sin tildes/case) para tolerar variantes.
    if re.match(r"^\(\*+\)\s+", n):
        return True

    # Excel serial date como header crudo (cell type DATE serializada a numero).
    # Ej: "40543.0" = 2010-12-31, "42400.0" = 2016-02-29, etc.
    # Rango: 36526.0 (2000-01-01) a 73050.0 (2100-01-01), con o sin decimales.
    if re.match(r"^\d{4,6}(\.0+)?$", n):
        return True

    # Fecha en formato ISO (con o sin hora). Ej: "2018-01-31 00:00:00"
    if re.match(r"^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?$", n):
        return True

    # Metadata textual: Tipo de Cambio, Balance General, Estado de GyP, etc.
    # Usamos lower() + sin tildes para tolerar variantes ("Pérdidas" vs "Perdidas").
    nlower = unicodedata.normalize("NFD", n).encode("ascii", "ignore").decode("ascii").lower()
    return nlower.startswith(
        (
            "tipo de cambio contable",
            "balance general por",
            "estado de ganancias y perdidas por",
            "estado de ganancias y perdidas y otro resultado integral",  # variante 2020+
            "(en miles de soles)",
            "(en miles de nuevos soles)",
            "actualizado al ",
            "actualizado el ",
        )
    )


def _normalize(s: str) -> str:
    """Normaliza nombres para matching robusto entre grupos SBS.

    Aplica:
    - strip de espacios (BANCOS indenta con '   Caja', CMAC sin indentar)
    - quita asterisco final ('Vigentes*' -> 'Vigentes')
    - quita acentos
    - lowercase
    - reemplaza puntuacion / paren / brackets / asteriscos por espacio
    - colapsa espacios multiples internos
    - DEBE COINCIDIR con la normalizacion del SQL en V108:
      LOWER(REGEXP_REPLACE(unaccent(s), '[^a-z0-9]+', ' ', 'g'))
    """
    s = s.strip()
    if s.endswith("*"):
        s = s[:-1].strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    # Reemplazar punctuation/paren/bracket/etc por espacio (matches SQL regex)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
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
