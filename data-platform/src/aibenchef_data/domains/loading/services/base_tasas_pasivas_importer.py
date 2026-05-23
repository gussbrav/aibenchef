"""BaseTasasPasivasImporter — carga BASE TASAS PASIVAS.xlsx hoja 'DATA PASIVAS'.

El archivo tiene header en row 2 (no row 0). Estructura:
- Fecha, Entidad
- Deposito de Ahorro (1 col)
- Hasta 30 dias, 31-90 dias, 91-180 dias, 181-360 dias, Mas de 360 dias (5 plazos)
- Depositos a Plazo (promedio), Depositos CTS
- Entidad Bench, SMF, Tipo

Unpivot a long: (periodo, empresa, producto, tasa).
"""

from __future__ import annotations

import time
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .base_helpers import normalizar_tipo, safe_text, to_numeric, to_periodo

log = get_logger(__name__)


# Cols con tasas → producto canonico
_TASAS_COLS = {
    "Depósitos de Ahorro": "Ahorro",
    "Depósitos a Plazo": "Plazo (promedio)",
    "Depósitos CTS": "CTS",
    "Hasta 30 días": "Plazo Hasta 30 dias",
    "31a90 días": "Plazo 31-90 dias",
    "91a180 días": "Plazo 91-180 dias",
    "181a360 días": "Plazo 181-360 dias",
    "Más de 360 días": "Plazo Mas de 360 dias",
}


def _normalize_col(c: str) -> str:
    """Normalizar columna eliminando caracteres latin-1 mojibake."""
    # Mapeo basico de mojibake -> ascii correcto
    repl = {
        "Dep�sitos": "Depósitos",
        "d�as": "días",
        "M�s": "Más",
        "31090": "31a90",
        "910180": "91a180",
        "1810360": "181a360",
    }
    s = c
    for old, new in repl.items():
        s = s.replace(old, new)
    return s.strip()


class BaseTasasPasivasImporter:
    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "DATA PASIVAS") -> ImportResult:
        start = time.perf_counter()
        log.info("tasas_pas.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            # Header en row 2 (0-indexed)
            df = pd.read_excel(path, sheet_name=sheet, header=2, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer {path}: {e}") from e

        df.columns = [_normalize_col(str(c)) for c in df.columns]
        log.info("tasas_pas.import.read", filas=len(df), cols=len(df.columns))

        # Detectar cols dim
        col_fecha = None
        col_entidad = None
        col_bench = None
        col_smf = None
        col_tipo = None
        for c in df.columns:
            cl = c.lower()
            if cl == "fecha":
                col_fecha = c
            elif cl == "entidad":
                col_entidad = c
            elif "bench" in cl:
                col_bench = c
            elif cl == "smf":
                col_smf = c
            elif cl == "tipo":
                col_tipo = c

        if not col_fecha or not col_entidad:
            raise ValidationError(f"Cols dim faltantes. Cols: {df.columns.tolist()}")

        # Resolver mapping col -> producto canonico (matching flexible)
        col_to_producto: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower().strip()
            for tasa_col, prod_canon in _TASAS_COLS.items():
                if cl == tasa_col.lower().strip():
                    col_to_producto[c] = prod_canon
                    break

        log.info("tasas_pas.import.mapping", cols_tasas=len(col_to_producto))

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get(col_fecha))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = safe_text(row.get(col_entidad))
                if not empresa:
                    skipped += 1
                    continue
                tipo = normalizar_tipo(safe_text(row.get(col_tipo)) if col_tipo else None)
                bench = safe_text(row.get(col_bench)) if col_bench else None
                smf = safe_text(row.get(col_smf)) if col_smf else None

                # Unpivot por cada col de tasa
                for col, producto in col_to_producto.items():
                    tasa = to_numeric(row.get(col))
                    if tasa is None:
                        continue
                    rows.append((
                        periodo, fc, empresa, bench, tipo, smf,
                        producto, tasa,
                        path.name,
                    ))
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("tasas_pas.import.parsed", rows=len(rows), skipped=skipped)

        if not rows:
            return ImportResult(
                source="base_tasas_pasivas", source_file=path.name,
                rows_inserted=0, rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.tasas_pasivas (
                periodo, fecha_cierre, empresa_sbs, entidad_benchmark, tipo_entidad, smf,
                producto, tasa_pct, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa_sbs, producto) DO UPDATE SET
                entidad_benchmark = EXCLUDED.entidad_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                smf = EXCLUDED.smf,
                tasa_pct = EXCLUDED.tasa_pct,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i:i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("tasas_pas.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_tasas_pasivas", source_file=path.name,
            rows_inserted=inserted, rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
