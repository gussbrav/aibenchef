"""Importers de CLIENTES (AHORROS y CREDITOS)."""

from __future__ import annotations

import time
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .base_helpers import normalizar_tipo, safe_text, to_int, to_periodo

log = get_logger(__name__)


def _read_excel(path: Path, sheet: str):
    try:
        import pandas as pd
    except ImportError as e:
        raise ValidationError(f"pandas no instalado: {e}") from e
    try:
        df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
    except Exception as e:
        raise ValidationError(f"No se pudo leer {path}: {e}") from e
    df.columns = [str(c).strip() for c in df.columns]
    return df


class BaseClientesAhorrosImporter:
    """Carga BASE CLIENTES AHORROS.xlsx hoja '2.BDClieAho'."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "2.BDClieAho") -> ImportResult:
        start = time.perf_counter()
        log.info("clie_aho.import.start", path=str(path))
        df = _read_excel(path, sheet)
        log.info("clie_aho.import.read", filas=len(df))

        # Mapeo flexible
        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "fecha":
                col_map["fecha"] = c
            elif cl == "tipo":
                col_map["tipo"] = c
            elif "clasifica" in cl and "50" not in cl:
                col_map["clasificacion"] = c
            elif cl == "empresa":
                col_map["empresa"] = c
            elif "benchmark" in cl:
                col_map["benchmark"] = c
            elif "personas naturales" in cl:
                col_map["pn"] = c
            elif "personas" in cl and ("lucro" in cl or "no fines" in cl):
                col_map["pj_nl"] = c
            elif "otras" in cl and ("juridic" in cl.lower() or "jur" in cl.lower()):
                col_map["otras_pj"] = c
            elif cl == "total":
                col_map["total"] = c
            elif cl == "producto":
                col_map["producto"] = c
            elif "mype" in cl or "50" in cl:
                col_map["mype50"] = c

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get(col_map.get("fecha")))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = safe_text(row.get(col_map.get("empresa")))
                producto = safe_text(row.get(col_map.get("producto")))
                if not empresa or not producto:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa,
                        safe_text(row.get(col_map.get("benchmark"))),
                        normalizar_tipo(safe_text(row.get(col_map.get("tipo")))),
                        safe_text(row.get(col_map.get("clasificacion"))),
                        safe_text(row.get(col_map.get("mype50"))),
                        producto,
                        to_int(row.get(col_map.get("pn"))),
                        to_int(row.get(col_map.get("pj_nl"))),
                        to_int(row.get(col_map.get("otras_pj"))),
                        to_int(row.get(col_map.get("total"))),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        if not rows:
            return ImportResult(
                source="base_clientes_ahorros",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.clientes_ahorros (
                periodo, fecha_cierre, empresa, empresa_benchmark, tipo_entidad,
                clasificacion, mayor_50_pct_mype, producto,
                n_pers_nat, n_pers_jur_no_lucro, n_otras_pers_jur, n_total, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion) DO UPDATE SET
                empresa_benchmark = EXCLUDED.empresa_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                mayor_50_pct_mype = EXCLUDED.mayor_50_pct_mype,
                n_pers_nat = EXCLUDED.n_pers_nat,
                n_pers_jur_no_lucro = EXCLUDED.n_pers_jur_no_lucro,
                n_otras_pers_jur = EXCLUDED.n_otras_pers_jur,
                n_total = EXCLUDED.n_total,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("clie_aho.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_clientes_ahorros",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )


class BaseClientesCreditosImporter:
    """Carga BASE CLIENTES CREDITOS.xlsx hoja '1.BDClieCred'."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "1.BDClieCred") -> ImportResult:
        start = time.perf_counter()
        log.info("clie_cred.import.start", path=str(path))
        df = _read_excel(path, sheet)
        log.info("clie_cred.import.read", filas=len(df))

        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "fecha":
                col_map["fecha"] = c
            elif cl == "tipo":
                col_map["tipo"] = c
            elif "clasifica" in cl and "50" not in cl:
                col_map["clasificacion"] = c
            elif cl == "empresa":
                col_map["empresa"] = c
            elif "benchmark" in cl:
                col_map["benchmark"] = c
            elif "clientes" in cl or "n�" in c.lower() or "no de" in cl or "n de" in cl:
                col_map["n_clientes"] = c
            elif cl == "producto":
                col_map["producto"] = c
            elif "cb" in cl or "50" in cl:
                col_map["cb50"] = c

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get(col_map.get("fecha")))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = safe_text(row.get(col_map.get("empresa")))
                producto = safe_text(row.get(col_map.get("producto")))
                if not empresa or not producto:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa,
                        safe_text(row.get(col_map.get("benchmark"))),
                        normalizar_tipo(safe_text(row.get(col_map.get("tipo")))),
                        safe_text(row.get(col_map.get("clasificacion"))),
                        safe_text(row.get(col_map.get("cb50"))),
                        producto,
                        to_int(row.get(col_map.get("n_clientes"))),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        if not rows:
            return ImportResult(
                source="base_clientes_creditos",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.clientes_creditos (
                periodo, fecha_cierre, empresa, empresa_benchmark, tipo_entidad,
                clasificacion, mayor_50_pct_cb, producto, n_clientes, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa, producto, clasificacion) DO UPDATE SET
                empresa_benchmark = EXCLUDED.empresa_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                mayor_50_pct_cb = EXCLUDED.mayor_50_pct_cb,
                n_clientes = EXCLUDED.n_clientes,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("clie_cred.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_clientes_creditos",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
