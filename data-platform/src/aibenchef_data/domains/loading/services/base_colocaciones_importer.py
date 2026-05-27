"""BaseColocacionesImporter — carga BASE COLOCACIONES.xlsx a raw.colocaciones_observacion.

Procesa la hoja '3.BDCreditos' del archivo consolidado:
- Una fila por (mes, entidad, producto, prod_consumo) en el .xlsx
- 16 columnas tidy: mes, Tipo, Clasificacion, Empresa, Empresa_Benchmark,
  Vigentes, Reest. y Refin., Atrasados, Total, Producto, Prod.Consumo,
  >50% CB, ID_EMPRESA, ID_SISTEMAFINANCIERO, ID_PRODUCTO, Observaciones
- Inserta a raw.colocaciones_observacion con COPY de Postgres
"""

from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult

log = get_logger(__name__)


# Mapeo de Tipo (Excel) -> tipo_entidad canonico
_TIPO_NORMALIZADO = {
    "BANCOS": "BANCOS",
    "FINANCIERAS": "FINANCIERAS",
    "CMACS": "CMAC",
    "CMAC": "CMAC",
    "CMUNICIPALES": "CMAC",
    "CAJAS MUNICIPALES": "CMAC",
    "CRACS": "CRAC",
    "CRAC": "CRAC",
    "CAJAS RURALES": "CRAC",
    "EDPYMES": "EDPYMES",
    "EDPYME": "EDPYMES",
}


def _normalizar_tipo(tipo: str | None) -> str:
    if not tipo:
        return "DESCONOCIDO"
    return _TIPO_NORMALIZADO.get(tipo.upper().strip(), tipo.upper().strip())


def _to_periodo(value: Any) -> tuple[int, date] | None:
    """Convierte una celda 'mes' a (periodo YYYYMM, fecha_cierre)."""
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


def _to_numeric(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        if value != value:  # NaN
            return None
        return float(value)
    if isinstance(value, str):
        s = value.replace(",", "").strip()
        if not s or s == "-":
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        if value != value:
            return None
        return int(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    return None


def _safe_text(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() == "nan":
        return None
    return s


class BaseColocacionesImporter:
    """Importer del XLSX consolidado BASE COLOCACIONES."""

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
        sheet: str = "3.BDCreditos",
    ) -> ImportResult:
        start = time.perf_counter()
        log.info("colocaciones.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer hoja '{sheet}' de {path}: {e}") from e

        log.info(
            "colocaciones.import.read",
            filas=len(df),
            columnas=len(df.columns),
        )

        # Normalizar nombres de columnas (latin-1 chars en 'Clasificación')
        df.columns = [str(c).strip() for c in df.columns]

        # Mapeo flexible de columnas (algunos archivos tienen encoding raro)
        col_map = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "mes":
                col_map["mes"] = c
            elif cl == "tipo":
                col_map["tipo"] = c
            elif "clasifica" in cl:
                col_map["clasificacion"] = c
            elif cl == "empresa":
                col_map["empresa"] = c
            elif "benchmark" in cl:
                col_map["empresa_benchmark"] = c
            elif cl == "vigentes":
                col_map["vigentes"] = c
            elif "reest" in cl or "refin" in cl:
                col_map["reest_refin"] = c
            elif "atrasad" in cl:
                col_map["atrasados"] = c
            elif cl == "total":
                col_map["total"] = c
            elif cl == "producto":
                col_map["producto"] = c
            elif "consumo" in cl:
                col_map["prod_consumo"] = c
            elif "50" in cl or "cb" in cl:
                col_map["mayor_50_cb"] = c
            elif "id_empresa" in cl:
                col_map["id_empresa"] = c
            elif "id_sistema" in cl:
                col_map["id_sistema"] = c
            elif "id_producto" in cl:
                col_map["id_producto"] = c
            elif "observac" in cl:
                col_map["observaciones"] = c

        required = ["mes", "tipo", "empresa", "producto"]
        missing = [r for r in required if r not in col_map]
        if missing:
            raise ValidationError(
                f"Columnas requeridas faltan en hoja '{sheet}': {missing}. "
                f"Disponibles: {df.columns.tolist()}"
            )

        rows_to_insert: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                periodo_info = _to_periodo(row[col_map["mes"]])
                if not periodo_info:
                    skipped += 1
                    continue
                periodo, fecha_cierre = periodo_info

                empresa = _safe_text(row[col_map["empresa"]])
                producto = _safe_text(row[col_map["producto"]])
                if not empresa or not producto:
                    skipped += 1
                    continue

                tipo_entidad = _normalizar_tipo(_safe_text(row[col_map["tipo"]]))
                empresa_benchmark = _safe_text(row.get(col_map.get("empresa_benchmark"), None))
                clasificacion = _safe_text(row.get(col_map.get("clasificacion"), None))
                prod_consumo = _safe_text(row.get(col_map.get("prod_consumo"), None))
                mayor_50 = _safe_text(row.get(col_map.get("mayor_50_cb"), None))

                vigente = _to_numeric(row.get(col_map.get("vigentes"), None))
                reest = _to_numeric(row.get(col_map.get("reest_refin"), None))
                atrasado = _to_numeric(row.get(col_map.get("atrasados"), None))
                total = _to_numeric(row.get(col_map.get("total"), None))

                id_emp = _to_int(row.get(col_map.get("id_empresa"), None))
                id_sis = _to_int(row.get(col_map.get("id_sistema"), None))
                id_prod = _to_int(row.get(col_map.get("id_producto"), None))

                obs = _safe_text(row.get(col_map.get("observaciones"), None))

                rows_to_insert.append(
                    (
                        periodo,
                        fecha_cierre,
                        empresa,
                        empresa_benchmark,
                        tipo_entidad,
                        clasificacion,
                        mayor_50,
                        producto,
                        prod_consumo,
                        id_emp,
                        id_sis,
                        id_prod,
                        vigente,
                        reest,
                        atrasado,
                        total,
                        obs,
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("colocaciones.import.parsed", parsed=len(rows_to_insert), skipped=skipped)

        if not rows_to_insert:
            return ImportResult(
                source="base_colocaciones",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        inserted = await self._copy_batch(rows_to_insert)

        return ImportResult(
            source="base_colocaciones",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )

    async def _copy_batch(self, rows: list[tuple]) -> int:
        """Inserta en batches con INSERT ... ON CONFLICT DO UPDATE para idempotencia."""
        sql = """
            INSERT INTO raw.colocaciones_observacion (
                periodo, fecha_cierre, empresa, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_cb,
                producto, prod_consumo,
                id_empresa_sbs, id_sistema_fin_sbs, id_producto_sbs,
                saldo_vigente, saldo_reest_refin, saldo_atrasado, saldo_total,
                observaciones, source_file
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s
            )
            ON CONFLICT (periodo, empresa, producto, clasificacion, prod_consumo)
            DO UPDATE SET
                empresa_benchmark = EXCLUDED.empresa_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                mayor_50_pct_cb = EXCLUDED.mayor_50_pct_cb,
                id_empresa_sbs = EXCLUDED.id_empresa_sbs,
                id_sistema_fin_sbs = EXCLUDED.id_sistema_fin_sbs,
                id_producto_sbs = EXCLUDED.id_producto_sbs,
                saldo_vigente = EXCLUDED.saldo_vigente,
                saldo_reest_refin = EXCLUDED.saldo_reest_refin,
                saldo_atrasado = EXCLUDED.saldo_atrasado,
                saldo_total = EXCLUDED.saldo_total,
                observaciones = EXCLUDED.observaciones,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info(
                    "colocaciones.import.batch_ok",
                    batch_n=i // self._batch_size + 1,
                    total=inserted,
                )
        return inserted
