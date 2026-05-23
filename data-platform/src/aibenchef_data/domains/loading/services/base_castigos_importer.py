"""BaseCastigosImporter — carga BASE CASTIGOS.xlsx a raw.castigos_observacion."""

from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)

_TIPO_NORMALIZADO = {
    "BANCOS": "BANCOS", "FINANCIERAS": "FINANCIERAS",
    "CMACS": "CMAC", "CMAC": "CMAC", "CAJAS MUNICIPALES": "CMAC",
    "CRACS": "CRAC", "CRAC": "CRAC", "CAJAS RURALES": "CRAC",
    "EDPYMES": "EDPYMES", "EDPYME": "EDPYMES",
}


def _normalizar_tipo(t: str | None) -> str:
    if not t:
        return "DESCONOCIDO"
    return _TIPO_NORMALIZADO.get(t.upper().strip(), t.upper().strip())


def _to_periodo(value: Any) -> tuple[int, date] | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    elif isinstance(value, str):
        try:
            d = datetime.fromisoformat(value.split(" ")[0]).date()
        except ValueError:
            return None
    else:
        return None
    return d.year * 100 + d.month, d


def _to_numeric(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if not s or s == "-":
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _to_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return None if v != v else int(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    return None


def _safe_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return None if not s or s.lower() == "nan" else s


class BaseCastigosImporter:
    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "Castigos") -> ImportResult:
        start = time.perf_counter()
        log.info("castigos.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer {path}: {e}") from e

        df.columns = [str(c).strip() for c in df.columns]
        log.info("castigos.import.read", filas=len(df), cols=len(df.columns))

        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "fecha":
                col_map["fecha"] = c
            elif cl == "tipo":
                col_map["tipo"] = c
            elif "clasifica" in cl and "50" not in cl and "mype" not in cl:
                col_map["clasificacion"] = c
            elif cl == "entidad":
                col_map["entidad"] = c
            elif "entidad_final" in cl.replace(" ", "_"):
                col_map["entidad_final"] = c
            elif "benchmark" in cl:
                col_map["empresa_benchmark"] = c
            elif cl == "castigos":
                col_map["castigos"] = c
            elif cl == "producto":
                col_map["producto"] = c
            elif "mype" in cl or "50" in cl:
                col_map["mayor_50"] = c
            elif "id_empresa" in cl:
                col_map["id_empresa"] = c
            elif "id_sistema" in cl:
                col_map["id_sistema"] = c
            elif "id_producto" in cl:
                col_map["id_producto"] = c

        required = ["fecha", "tipo", "entidad", "producto"]
        missing = [r for r in required if r not in col_map]
        if missing:
            raise ValidationError(f"Cols faltantes: {missing}. Disponibles: {df.columns.tolist()}")

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = _to_periodo(row[col_map["fecha"]])
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                entidad = _safe_text(row[col_map["entidad"]])
                producto = _safe_text(row[col_map["producto"]])
                if not entidad or not producto:
                    skipped += 1
                    continue
                rows.append((
                    periodo, fc,
                    entidad,
                    _safe_text(row.get(col_map.get("entidad_final"))),
                    _safe_text(row.get(col_map.get("empresa_benchmark"))),
                    _normalizar_tipo(_safe_text(row[col_map["tipo"]])),
                    _safe_text(row.get(col_map.get("clasificacion"))),
                    _safe_text(row.get(col_map.get("mayor_50"))),
                    producto,
                    _to_int(row.get(col_map.get("id_empresa"))),
                    _to_int(row.get(col_map.get("id_sistema"))),
                    _to_int(row.get(col_map.get("id_producto"))),
                    _to_numeric(row.get(col_map.get("castigos"))),
                    path.name,
                ))
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("castigos.import.parsed", parsed=len(rows), skipped=skipped)

        if not rows:
            return ImportResult(
                source="base_castigos", source_file=path.name,
                rows_inserted=0, rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.castigos_observacion (
                periodo, fecha_cierre, entidad, entidad_final, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_mype, producto,
                id_empresa_sbs, id_sistema_fin_sbs, id_producto_sbs,
                saldo_castigos, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, entidad, producto, clasificacion) DO UPDATE SET
                entidad_final = EXCLUDED.entidad_final,
                empresa_benchmark = EXCLUDED.empresa_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                mayor_50_pct_mype = EXCLUDED.mayor_50_pct_mype,
                id_empresa_sbs = EXCLUDED.id_empresa_sbs,
                id_sistema_fin_sbs = EXCLUDED.id_sistema_fin_sbs,
                id_producto_sbs = EXCLUDED.id_producto_sbs,
                saldo_castigos = EXCLUDED.saldo_castigos,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i:i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("castigos.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_castigos", source_file=path.name,
            rows_inserted=inserted, rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
