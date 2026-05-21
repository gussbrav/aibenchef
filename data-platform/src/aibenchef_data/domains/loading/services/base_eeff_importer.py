"""BaseEeffImporter — carga BASE EE.FF..xlsx a raw.eeff_observacion.

Procesa las hojas BG y ER del archivo unificado de Gus:
- Una fila por (entidad, mes, moneda) en el .xlsx
- Una columna por cuenta canonica con codigo regulatorio "(A1.1) Caja"
- Genera N observaciones por fila (una por cuenta no-null)
- Inserta a raw.eeff_observacion en batches con COPY de Postgres
"""

from __future__ import annotations

import io
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import psycopg

from aibenchef_data.domains.catalog.cuenta import parse_label
from aibenchef_data.domains.parsing import XlsSheet, read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)


# Columnas dimensionales en la fila 0 de BG/ER
_DIM_COLS_LOWER = {
    "code", "mes", "tipo entidad", "microfinan.", "microfinan",
    "nacional", "empresa sbs", "nomb_correg", "moneda",
}


class BaseEeffImporter:
    def __init__(
        self,
        conn: psycopg.AsyncConnection,
        *,
        batch_size: int = 10_000,
    ) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(
        self,
        path: Path,
        *,
        bg_sheet: str = "BG",
        er_sheet: str = "ER",
    ) -> ImportResult:
        start = time.perf_counter()
        log.info("import.start", path=str(path))

        sheets = read_xls(path)
        by_name = {s.name.upper(): s for s in sheets}

        if bg_sheet.upper() not in by_name and er_sheet.upper() not in by_name:
            raise ValidationError(
                "No se encontraron hojas BG ni ER", context={"file": path.name}
            )

        inserted = 0
        errors: list[str] = []

        for tipo_estado, sheet_name in (
            ("balance", bg_sheet.upper()),
            ("resultados", er_sheet.upper()),
        ):
            sheet = by_name.get(sheet_name)
            if sheet is None:
                log.warning("import.skip_missing_sheet", sheet=sheet_name)
                continue
            try:
                n = await self._import_sheet(
                    sheet=sheet,
                    tipo_estado=tipo_estado,
                    source_file=path.name,
                )
                inserted += n
                log.info(
                    "import.sheet_done",
                    sheet=sheet.name,
                    tipo_estado=tipo_estado,
                    rows=n,
                )
            except Exception as e:
                errors.append(f"sheet={sheet.name}: {e}")
                log.error("import.sheet_failed", sheet=sheet.name, error=str(e))
                # Rollback para que la siguiente hoja arranque limpia
                try:
                    await self._conn.rollback()
                except Exception:
                    pass

        return ImportResult(
            source="base_eeff",
            source_file=path.name,
            rows_inserted=inserted,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )

    async def _import_sheet(
        self,
        *,
        sheet: XlsSheet,
        tipo_estado: str,
        source_file: str,
    ) -> int:
        """Procesa una hoja (BG o ER) y vuelca observaciones a raw.eeff_observacion."""
        if sheet.n_rows < 2:
            return 0

        col_map = _detect_columns(sheet)
        cuentas_cols = _detect_cuenta_columns(sheet, col_map)
        log.info(
            "sheet.layout",
            sheet=sheet.name,
            tipo_estado=tipo_estado,
            dimension_cols=len(col_map),
            cuenta_cols=len(cuentas_cols),
            data_rows=sheet.n_rows - 1,
        )

        inserted = 0
        batch: list[tuple] = []

        for r in range(1, sheet.n_rows):
            row_obs = _row_to_observations(
                sheet=sheet,
                row_idx=r,
                col_map=col_map,
                cuentas_cols=cuentas_cols,
                tipo_estado=tipo_estado,
                source_file=source_file,
            )
            batch.extend(row_obs)

            if len(batch) >= self._batch_size:
                inserted += await self._copy_batch(batch)
                batch = []

        if batch:
            inserted += await self._copy_batch(batch)

        return inserted

    async def _copy_batch(self, batch: list[tuple]) -> int:
        """Usa COPY FROM STDIN para insertar las observaciones eficientemente.

        COPY no maneja ON CONFLICT directo. El approach:
        1. DROP + CREATE staging temp (sin ON COMMIT DROP — manejamos manualmente).
        2. COPY a la temp.
        3. INSERT ... ON CONFLICT DO UPDATE desde la temp a la real.
        4. COMMIT al final del batch para liberar locks.
        """
        # Si una invocacion previa fallo dejando la temp creada, la limpiamos.
        try:
            await self._conn.rollback()
        except Exception:
            pass

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
                       'base_eeff', source_file
                FROM _eeff_stage
                ON CONFLICT (periodo, nomb_correg, moneda, tipo_estado, cuenta_codigo)
                DO UPDATE SET
                    valor       = EXCLUDED.valor,
                    loaded_at   = now()
                """
            )
            n = cur.rowcount
            await cur.execute("DROP TABLE IF EXISTS _eeff_stage")

        # Commit del batch para liberar locks y que el siguiente batch arranque limpio.
        await self._conn.commit()
        return n


# ============================================================================
# Helpers de parsing del layout
# ============================================================================


def _detect_columns(sheet: XlsSheet) -> dict[str, int]:
    """Identifica las columnas dimensionales por nombre en la fila 0."""
    header = sheet.row(0)
    col_map: dict[str, int] = {}
    for idx, raw in enumerate(header):
        if raw is None:
            continue
        key = str(raw).strip().lower()
        if key in _DIM_COLS_LOWER:
            col_map[key] = idx
    return col_map


def _detect_cuenta_columns(
    sheet: XlsSheet,
    col_map: dict[str, int],
) -> list[tuple[int, str, str]]:
    """Devuelve [(col_idx, codigo, nombre), ...] para las columnas de cuentas."""
    header = sheet.row(0)
    dim_indices = set(col_map.values())
    cuentas: list[tuple[int, str, str]] = []
    for idx, raw in enumerate(header):
        if idx in dim_indices or raw is None:
            continue
        label = str(raw).strip()
        if not label:
            continue
        codigo, nombre = parse_label(label)
        if not codigo:
            continue
        cuentas.append((idx, codigo, nombre or codigo))
    return cuentas


def _row_to_observations(
    *,
    sheet: XlsSheet,
    row_idx: int,
    col_map: dict[str, int],
    cuentas_cols: list[tuple[int, str, str]],
    tipo_estado: str,
    source_file: str,
) -> Iterable[tuple]:
    """Convierte una fila a N observaciones (una por cuenta no-null)."""
    mes_val = _cell(sheet, row_idx, col_map.get("mes"))
    fecha_cierre = _coerce_date(mes_val)
    if fecha_cierre is None:
        return ()

    periodo_yyyymm = fecha_cierre.year * 100 + fecha_cierre.month
    nomb_correg = _cell_str(sheet, row_idx, col_map.get("nomb_correg"))
    if not nomb_correg:
        return ()
    tipo_entidad = _cell_str(sheet, row_idx, col_map.get("tipo entidad")) or ""
    moneda = (_cell_str(sheet, row_idx, col_map.get("moneda")) or "").upper()
    if moneda not in ("MN", "ME", "TOTAL"):
        return ()
    empresa_sbs = _cell_str(sheet, row_idx, col_map.get("empresa sbs"))
    microfinanciera = _cell_str(
        sheet, row_idx, col_map.get("microfinan.") or col_map.get("microfinan")
    )
    nacional = _cell_str(sheet, row_idx, col_map.get("nacional"))

    obs: list[tuple] = []
    for col_idx, codigo, nombre in cuentas_cols:
        raw_val = sheet.cell(row_idx, col_idx)
        if raw_val is None:
            continue
        valor = _coerce_number(raw_val)
        if valor is None:
            continue
        obs.append(
            (
                periodo_yyyymm,
                fecha_cierre,
                tipo_estado,
                empresa_sbs,
                nomb_correg,
                tipo_entidad,
                microfinanciera,
                nacional,
                moneda,
                codigo,
                nombre,
                valor,
                source_file,
            )
        )
    return obs


def _cell(sheet: XlsSheet, row: int, col: int | None) -> Any:
    if col is None:
        return None
    return sheet.cell(row, col)


def _cell_str(sheet: XlsSheet, row: int, col: int | None) -> str | None:
    v = _cell(sheet, row, col)
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
        # Excel serial date (1900 epoch)
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
    """Convierte numero serial Excel a date (epoch 1899-12-30 con bug 1900)."""
    from datetime import timedelta

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
