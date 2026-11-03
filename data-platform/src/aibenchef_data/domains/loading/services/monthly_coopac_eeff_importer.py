"""MonthlyCoopacEeffImporter — carga archivos EE.FF. mensuales de COOPAC a raw.eeff_observacion.

Los archivos COOPAC tienen el mismo layout XLS que los SF (SF = sistema financiero):
    - row 5: nombres de entidades
    - row 6: monedas MN | ME | TOTAL
    - row 8+: filas de cuentas

La diferencia clave es que las cuentas COOPAC se identifican por NOMBRE TEXTUAL
(no por codigo numerico SBS). Este importer traduce esos nombres a codigos SF
equivalentes usando dos mapas fijos: _BG_CUENTAS (balance) y _GYP_CUENTAS (resultados).

El mecanismo es stateful: cuando ve una fila en MAYUSCULAS es un header parent;
las siguientes filas mixed-case son hijos bajo ese parent hasta el proximo header.

Grupos soportados: coopac_n1, coopac_n2a, coopac_n2b, coopac_n3.

ROLLBACK (si necesitas revertir una ingesta):
    DELETE FROM raw.eeff_observacion WHERE tipo_entidad LIKE 'COOPAC_%';
    DELETE FROM raw.eeff_celda_cruda WHERE tipo_entidad LIKE 'COOPAC_%';
    -- Luego refrescar MVs:
    -- REFRESH MATERIALIZED VIEW CONCURRENTLY marts.mv_eeff_resultados_ancho;
"""

from __future__ import annotations

import contextlib
import time
from pathlib import Path
from typing import Any

import psycopg

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .monthly_eeff_importer import (
    MonthlyEeffImporter,
    _cell_str,
    _classify_sheet,
    _coerce_number,
    _detect_layout,
    _normalize,
)

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Mapa de tipo_entidad inferido desde el segmento de path del grupo COOPAC
# ---------------------------------------------------------------------------

_PATH_COOPAC_TO_TIPO: dict[str, str] = {
    "coopac_n3": "COOPAC_N3",
    "coopac_n2b": "COOPAC_N2B",
    "coopac_n2a": "COOPAC_N2A",
    "coopac_n1": "COOPAC_N1",
}


def _infer_tipo_entidad_coopac(path: Path) -> str | None:
    """Infiere tipo_entidad desde los segmentos del path para archivos COOPAC.

    Busca cualquier segmento del path que coincida con las claves de
    _PATH_COOPAC_TO_TIPO (ej. .../coopac_n3/eeff/202401/... -> COOPAC_N3).
    """
    for part in path.parts:
        key = part.lower()
        if key in _PATH_COOPAC_TO_TIPO:
            return _PATH_COOPAC_TO_TIPO[key]
    return None


class MonthlyCoopacEeffImporter(MonthlyEeffImporter):
    """Importa archivos EE.FF. mensuales de COOPAC a raw.eeff_observacion.

    Hereda de MonthlyEeffImporter para reutilizar _copy_batch y
    _copy_batch_celdas (los metodos de escritura a DB).

    La diferencia con MonthlyEeffImporter es que NO usa dim_cuenta ni
    cabecera_maestra para resolver nombres: usa los mapas fijos _BG_CUENTAS
    y _GYP_CUENTAS definidos como constantes de clase.

    Uso:
        importer = MonthlyCoopacEeffImporter(conn, batch_size=5000)
        result = await importer.import_file(path)
    """

    # -----------------------------------------------------------------------
    # Mapa de cuentas para Estado de Ganancias y Perdidas (resultados)
    # Clave: (parent_code | None, nombre_normalizado) -> cuenta_codigo
    # -----------------------------------------------------------------------
    _GYP_CUENTAS: dict[tuple[str | None, str], str] = {
        (None, "ingresos financieros"): "1",
        ("1", "creditos directos"): "1.4",
        ("1", "inversiones"): "1.3",
        ("1", "diferencia de cambio"): "1.7",
        ("1", "otros"): "1.10",
        (None, "gastos financieros"): "2",
        ("2", "obligaciones con los socios"): "2.1",
        ("2", "adeudos y obligaciones financieras"): "2.4",
        ("2", "otros gastos financieros"): "2.13",
        ("2", "otros"): "2.13",
        (None, "margen financiero bruto"): "3",
        (None, "provisiones para creditos directos"): "4",
        (None, "ingresos por servicios financieros"): "6",
        (None, "gastos por servicios financieros"): "7",
        (None, "resultado por operaciones financieras"): "8",
        (None, "gastos administrativos"): "10",
        ("10", "personal"): "10.1",
        ("10", "directorio"): "10.2",
        ("10", "servicios recibidos de terceros"): "10.3",
        ("10", "impuestos y contribuciones"): "10.4",
        (None, "provisiones depreciacion y amortizacion"): "12",
        ("12", "depreciacion"): "12.7",
        ("12", "amortizacion"): "12.8",
        (None, "otros ingresos y gastos"): "13",
        (None, "resultado neto del ejercicio"): "17",
    }

    # -----------------------------------------------------------------------
    # Mapa de cuentas para Balance General
    # Clave: (parent_code | None, nombre_normalizado) -> cuenta_codigo
    # -----------------------------------------------------------------------
    _BG_CUENTAS: dict[tuple[str | None, str], str] = {
        (None, "activo"): "A",
        ("A", "disponible"): "A1",
        ("A1", "caja y canje"): "A1.1",
        ("A1", "depositos en empresas del sistema financiero"): "A1.2",
        ("A1", "otros"): "A1.4",
        ("A", "fondos interbancarios"): "A2",
        ("A", "inversiones financieras"): "A3",
        ("A", "creditos directos"): "A4",
        ("A4", "creditos vigentes"): "A4.1",
        ("A4", "creditos reestructurados"): "A4.2",
        ("A4", "creditos refinanciados"): "A4.2",
        ("A4", "creditos vencidos"): "A4.3",
        ("A4", "creditos en cobranza judicial"): "A4.4",
        ("A4", "provisiones"): "A4.6",
        ("A4", "intereses y comisiones no devengados"): "A4.7",
        ("A", "activos fijos"): "A6",
        ("A", "otros activos"): "A7",
        (None, "pasivo"): "B",
        ("B", "obligaciones con los socios"): "B1",
        ("B1", "depositos de ahorro"): "B1.2",
        ("B1", "depositos a plazo"): "B1.3",
        ("B1", "depositos cts"): "B1.3.3",
        ("B", "adeudos y obligaciones financieras"): "B3",
        ("B", "otros pasivos"): "B6",
        (None, "patrimonio"): "C",
        ("C", "capital social"): "C1",
        ("C", "reservas"): "C3",
        ("C", "resultados acumulados"): "C5",
        ("C", "resultado neto del ejercicio"): "C6",
    }

    def __init__(
        self,
        conn: psycopg.AsyncConnection,
        *,
        batch_size: int = 5_000,
    ) -> None:
        super().__init__(conn, batch_size=batch_size)

    async def import_file(
        self,
        path: Path,
        *,
        tipo_entidad: str | None = None,
        archivo_id: str | None = None,
    ) -> ImportResult:
        """Importa un archivo XLS mensual COOPAC a raw.eeff_observacion.

        NO llama a super().import_file() porque la logica de resolucion de
        nombres es distinta (mapa fijo vs dim_cuenta + cabecera_maestra).

        Args:
            path: Ruta al .xls COOPAC.
            tipo_entidad: COOPAC_N3 / COOPAC_N2B / COOPAC_N2A / COOPAC_N1.
                Si None, se infiere desde los segmentos del path.
            archivo_id: UUID de raw.archivos_descargados para trazabilidad.
        """
        start = time.perf_counter()

        if tipo_entidad is None:
            tipo_entidad = _infer_tipo_entidad_coopac(path)
            if tipo_entidad is None:
                raise ValidationError(
                    "No pude inferir tipo_entidad del path COOPAC. Pasa tipo_entidad explicito.",
                    context={"path": str(path)},
                )

        log.info("coopac_eeff.start", path=str(path), tipo_entidad=tipo_entidad)

        sheets = read_xls(path)
        balance_sheets = []
        resultado_sheets = []
        for s in sheets:
            kind = _classify_sheet(s)
            if kind == "balance":
                balance_sheets.append(s)
            elif kind == "resultados":
                resultado_sheets.append(s)

        if not balance_sheets and not resultado_sheets:
            raise ValidationError(
                "No se identificaron hojas BG/ER en el archivo COOPAC",
                context={"file": path.name, "sheets": [s.name for s in sheets]},
            )

        # Igual que MonthlyEeffImporter: exigir ambos sheets para detectar
        # descargas truncadas temprano (incidente C-4103-my2026).
        if not balance_sheets or not resultado_sheets:
            missing = "balance" if not balance_sheets else "resultados"
            raise ValidationError(
                f"Archivo COOPAC no trae sheet de '{missing}' — probable descarga "
                f"truncada. Re-descargar con force_redownload=true.",
                context={
                    "file": path.name,
                    "sheets_encontrados": [s.name for s in sheets],
                    "balance_sheets": [s.name for s in balance_sheets],
                    "resultado_sheets": [s.name for s in resultado_sheets],
                },
            )

        inserted = 0
        errors: list[str] = []

        for sheet in balance_sheets:
            try:
                n = await self._import_coopac_sheet(
                    sheet=sheet,
                    tipo_estado="balance",
                    tipo_entidad=tipo_entidad,
                    source_file=path.name,
                    archivo_id=archivo_id,
                    cuentas_map=self._BG_CUENTAS,
                )
                inserted += n
                log.info("coopac_eeff.sheet_ok", sheet=sheet.name, rows=n)
            except Exception as e:
                errors.append(f"sheet={sheet.name}: {e}")
                log.error("coopac_eeff.sheet_failed", sheet=sheet.name, error=str(e))
                with contextlib.suppress(Exception):
                    await self._conn.rollback()

        for sheet in resultado_sheets:
            try:
                n = await self._import_coopac_sheet(
                    sheet=sheet,
                    tipo_estado="resultados",
                    tipo_entidad=tipo_entidad,
                    source_file=path.name,
                    archivo_id=archivo_id,
                    cuentas_map=self._GYP_CUENTAS,
                )
                inserted += n
                log.info("coopac_eeff.sheet_ok", sheet=sheet.name, rows=n)
            except Exception as e:
                errors.append(f"sheet={sheet.name}: {e}")
                log.error("coopac_eeff.sheet_failed", sheet=sheet.name, error=str(e))
                with contextlib.suppress(Exception):
                    await self._conn.rollback()

        return ImportResult(
            source="coopac_eeff",
            source_file=path.name,
            rows_inserted=inserted,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )

    async def _import_coopac_sheet(
        self,
        *,
        sheet: Any,
        tipo_estado: str,
        tipo_entidad: str,
        source_file: str,
        archivo_id: str | None,
        cuentas_map: dict[tuple[str | None, str], str],
    ) -> int:
        """Parsea una hoja COOPAC y escribe observaciones a raw.eeff_observacion.

        Estrategia:
        - Detecta el layout con _detect_layout (funciona igual para COOPAC).
        - Recorre filas de datos con un state machine de parent actual.
        - Una fila en MAYUSCULAS es un header: busca en (None, nombre_norm).
        - Una fila mixed-case es un hijo: busca en (current_parent_code, nombre_norm).
        - Si el codigo no se resuelve, la observacion se descarta (pero la celda
          cruda se guarda igual para el inspector).
        """
        layout = _detect_layout(sheet)
        if not layout.entidades:
            log.warning("coopac_eeff.no_entities", sheet=sheet.name)
            return 0

        log.info(
            "coopac_eeff.layout",
            sheet=sheet.name,
            entidades=len(layout.entidades),
            fecha_cierre=str(layout.fecha_cierre),
            data_start_row=layout.data_start_row,
        )

        observations: list[tuple] = []
        cells_raw: list[tuple] = []

        # Maquina de estado: current_parent_code es el codigo del ultimo header visto.
        # Empieza en None porque el primer header no tiene parent.
        current_parent_code: str | None = None
        orden = 0

        for r in range(layout.data_start_row, sheet.n_rows):
            nombre_raw = _cell_str(sheet, r, layout.nombre_col)
            if not nombre_raw:
                continue

            orden += 1
            nombre_norm = _normalize(nombre_raw)
            # Detector de header: COOPAC usa MAYUSCULAS para cuentas L1/L2,
            # mixed-case para cuentas hijo. Misma convencion que SF.
            es_header = nombre_raw.strip() == nombre_raw.strip().upper()

            # Resolver codigo desde el mapa fijo
            lookup_key = (None, nombre_norm) if es_header else (current_parent_code, nombre_norm)

            codigo: str | None = cuentas_map.get(lookup_key)

            # Si el header resolvio, actualizar el parent para las filas siguientes
            if es_header and codigo is not None:
                current_parent_code = codigo
            elif es_header and codigo is None:
                # Header no reconocido: resetear parent para evitar asignaciones
                # incorrectas de hijos bajo un parent fantasma.
                current_parent_code = None

            # Captura de celdas crudas para todas las entidades del layout,
            # incluyendo filas sin codigo (el inspector las muestra como sin asignar).
            for entidad_info in layout.entidades:
                vals_raw: dict[str, float] = {}
                for moneda, col_idx in entidad_info.monedas.items():
                    raw_val = sheet.cell(r, col_idx)
                    v = _coerce_number(raw_val)
                    if v is not None:
                        vals_raw[moneda] = v

                # Si codigo resolvio: completar monedas con 0 (celda vacia = sin movimiento)
                if codigo:
                    for moneda in entidad_info.monedas:
                        vals_raw.setdefault(moneda, 0.0)

                if codigo or vals_raw:
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
                            vals_raw.get("TOTAL"),
                            archivo_id,
                            source_file,
                            codigo,
                        )
                    )

            if not codigo:
                continue

            # Nombre canonico: el nombre raw limpio (no hay dim_cuenta para COOPAC)
            cuenta_nombre = nombre_raw.strip()

            for entidad_info in layout.entidades:
                vals_by_moneda: dict[str, float] = {}
                for moneda, col_idx in entidad_info.monedas.items():
                    raw_val = sheet.cell(r, col_idx)
                    v = _coerce_number(raw_val)
                    if v is not None:
                        vals_by_moneda[moneda] = v

                # Si no hay TOTAL pero si MN y ME: calcularlo
                if (
                    "TOTAL" not in vals_by_moneda
                    and "MN" in vals_by_moneda
                    and "ME" in vals_by_moneda
                ):
                    vals_by_moneda["TOTAL"] = vals_by_moneda["MN"] + vals_by_moneda["ME"]

                for moneda, valor in vals_by_moneda.items():
                    observations.append(
                        (
                            layout.periodo_yyyymm,  # periodo INT
                            layout.fecha_cierre,  # fecha_cierre DATE
                            tipo_estado,  # 'balance' | 'resultados'
                            None,  # empresa_sbs (no disponible en COOPAC)
                            entidad_info.nombre,  # nomb_correg TEXT
                            tipo_entidad,  # 'COOPAC_N3' etc
                            None,  # microfinanciera (no disponible)
                            None,  # nacional (no disponible)
                            moneda,  # 'MN' | 'ME' | 'TOTAL'
                            codigo,  # cuenta_codigo
                            cuenta_nombre,  # nombre desde el archivo
                            valor,  # NUMERIC
                            source_file,  # path.name
                        )
                    )

        # Dedup observaciones por (nomb_correg, moneda, codigo): conservar primera
        seen: set[tuple] = set()
        deduped: list[tuple] = []
        for obs in observations:
            # obs[4] = nomb_correg, obs[8] = moneda, obs[9] = codigo
            key = (obs[4], obs[8], obs[9])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(obs)

        # Dedup celdas crudas por (nomb_correg, tipo_estado, orden)
        seen_raw: set[tuple] = set()
        deduped_raw: list[tuple] = []
        for cell in cells_raw:
            # cell[1] = nomb_correg, cell[3] = tipo_estado, cell[4] = orden
            key_raw = (cell[1], cell[3], cell[4])
            if key_raw in seen_raw:
                continue
            seen_raw.add(key_raw)
            deduped_raw.append(cell)

        # Volcar observaciones en batches
        inserted = 0
        for i in range(0, len(deduped), self._batch_size):
            batch = deduped[i : i + self._batch_size]
            inserted += await self._copy_batch(batch)

        # Volcar celdas crudas (para el inspector)
        for i in range(0, len(deduped_raw), self._batch_size):
            batch_raw = deduped_raw[i : i + self._batch_size]
            await self._copy_batch_celdas(batch_raw)

        return inserted
