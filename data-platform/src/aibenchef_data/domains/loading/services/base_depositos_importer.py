"""BaseDepositosImporter — carga BASE DEPOSITOS.xlsx a raw.depositos_observacion."""

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
    "BANCOS": "BANCOS",
    "FINANCIERAS": "FINANCIERAS",
    "CMACS": "CMAC",
    "CMAC": "CMAC",
    "CAJAS MUNICIPALES": "CMAC",
    "CRACS": "CRAC",
    "CRAC": "CRAC",
    "CAJAS RURALES": "CRAC",
    "EDPYMES": "EDPYMES",
    "EDPYME": "EDPYMES",
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


def _safe_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return None if not s or s.lower() == "nan" else s


class BaseDepositosImporter:
    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "4.BDAhorros") -> ImportResult:
        start = time.perf_counter()
        log.info("depositos.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer {path}: {e}") from e

        df.columns = [str(c).strip() for c in df.columns]
        log.info("depositos.import.read", filas=len(df), cols=len(df.columns))

        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "mes":
                col_map["mes"] = c
            elif cl == "tipo":
                col_map["tipo"] = c
            elif "clasifica" in cl and "50" not in cl:
                col_map["clasificacion"] = c
            elif cl == "empresa":
                col_map["empresa"] = c
            elif "benchmark" in cl:
                col_map["empresa_benchmark"] = c
            elif "pers nat" in cl:
                col_map["pers_nat"] = c
            elif "pers jur" in cl and ("lucro" in cl or "no fines" in cl):
                col_map["pers_jur_nl"] = c
            elif "otras" in cl and "jur" in cl:
                col_map["otras_jur"] = c
            elif cl == "total":
                col_map["total"] = c
            elif cl == "producto":
                col_map["producto"] = c
            elif "50" in cl:
                col_map["mayor_50"] = c

        required = ["mes", "tipo", "empresa", "producto"]
        missing = [r for r in required if r not in col_map]
        if missing:
            raise ValidationError(f"Cols faltantes: {missing}")

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = _to_periodo(row[col_map["mes"]])
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = _safe_text(row[col_map["empresa"]])
                producto = _safe_text(row[col_map["producto"]])
                if not empresa or not producto:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa,
                        _safe_text(row.get(col_map.get("empresa_benchmark"))),
                        _normalizar_tipo(_safe_text(row[col_map["tipo"]])),
                        _safe_text(row.get(col_map.get("clasificacion"))),
                        _safe_text(row.get(col_map.get("mayor_50"))),
                        producto,
                        _to_numeric(row.get(col_map.get("pers_nat"))),
                        _to_numeric(row.get(col_map.get("pers_jur_nl"))),
                        _to_numeric(row.get(col_map.get("otras_jur"))),
                        _to_numeric(row.get(col_map.get("total"))),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("depositos.import.parsed", parsed=len(rows), skipped=skipped)

        if not rows:
            return ImportResult(
                source="base_depositos",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.depositos_observacion (
                periodo, fecha_cierre, empresa, empresa_benchmark, tipo_entidad,
                clasificacion, mayor_50_pct_mype, producto,
                saldo_pers_nat, saldo_pers_jur_no_lucro, saldo_otras_pers_jur, saldo_total,
                source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion) DO UPDATE SET
                empresa_benchmark = EXCLUDED.empresa_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                mayor_50_pct_mype = EXCLUDED.mayor_50_pct_mype,
                saldo_pers_nat = EXCLUDED.saldo_pers_nat,
                saldo_pers_jur_no_lucro = EXCLUDED.saldo_pers_jur_no_lucro,
                saldo_otras_pers_jur = EXCLUDED.saldo_otras_pers_jur,
                saldo_total = EXCLUDED.saldo_total,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("depositos.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_depositos",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
