"""BaseCreditosDistritoImporter — carga BASE_Creditos_por_tipo_distrito.xlsx."""

from __future__ import annotations

import time
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .base_helpers import safe_text, to_numeric, to_periodo

log = get_logger(__name__)


class BaseCreditosDistritoImporter:
    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "BD") -> ImportResult:
        start = time.perf_counter()
        log.info("creditos_dist.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer {path}: {e}") from e

        df.columns = [str(c).strip() for c in df.columns]
        log.info("creditos_dist.import.read", filas=len(df))

        # Mapeo flexible
        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "nom_bd":
                col_map["nom_bd"] = c
            elif cl == "fecha":
                col_map["fecha"] = c
            elif cl == "departamento":
                col_map["depto"] = c
            elif cl == "provincia":
                col_map["provincia"] = c
            elif cl == "distrito":
                col_map["distrito"] = c
            elif "regi" in cl and "caja" in cl:
                col_map["region"] = c
            elif "tipo de credito" in cl or "tipo de crédito" in cl:
                col_map["tipo_cred"] = c
            elif "tipo_base" in cl or "tipo base" in cl:
                col_map["tipo_base"] = c
            elif cl == "bancos":
                col_map["bancos"] = c
            elif cl == "financieras":
                col_map["financieras"] = c
            elif "cmac" in cl:
                col_map["cmac"] = c
            elif "crac" in cl:
                col_map["crac"] = c
            elif "edpyme" in cl:
                col_map["edpymes"] = c
            elif "total" in cl and "tipo" in cl:
                col_map["total_tipo"] = c
            elif "total" in cl and ("direct" in cl or "cr" in cl):
                col_map["total_directos"] = c

        required = ["fecha", "depto", "tipo_cred"]
        missing = [r for r in required if r not in col_map]
        if missing:
            raise ValidationError(f"Cols faltantes: {missing}. Tengo: {df.columns.tolist()}")

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get(col_map["fecha"]))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                depto = safe_text(row.get(col_map["depto"]))
                tipo_cred = safe_text(row.get(col_map["tipo_cred"]))
                if not depto or not tipo_cred:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        safe_text(row.get(col_map.get("nom_bd"))),
                        depto,
                        safe_text(row.get(col_map.get("provincia"))),
                        safe_text(row.get(col_map.get("distrito"))) or "(sin distrito)",
                        safe_text(row.get(col_map.get("region"))),
                        tipo_cred,
                        safe_text(row.get(col_map.get("tipo_base"))),
                        to_numeric(row.get(col_map.get("bancos"))),
                        to_numeric(row.get(col_map.get("financieras"))),
                        to_numeric(row.get(col_map.get("cmac"))),
                        to_numeric(row.get(col_map.get("crac"))),
                        to_numeric(row.get(col_map.get("edpymes"))),
                        to_numeric(row.get(col_map.get("total_tipo"))),
                        to_numeric(row.get(col_map.get("total_directos"))),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("creditos_dist.import.parsed", rows=len(rows), skipped=skipped)

        if not rows:
            return ImportResult(
                source="base_creditos_distrito",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.creditos_distrito (
                periodo, fecha_cierre, nom_bd, departamento, provincia, distrito,
                region_caja, tipo_credito, tipo_base,
                saldo_bancos, saldo_financieras, saldo_cmac, saldo_crac, saldo_edpymes,
                saldo_total_tipo, saldo_total_directos, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, departamento, distrito, tipo_credito) DO UPDATE SET
                nom_bd = EXCLUDED.nom_bd,
                provincia = EXCLUDED.provincia,
                region_caja = EXCLUDED.region_caja,
                tipo_base = EXCLUDED.tipo_base,
                saldo_bancos = EXCLUDED.saldo_bancos,
                saldo_financieras = EXCLUDED.saldo_financieras,
                saldo_cmac = EXCLUDED.saldo_cmac,
                saldo_crac = EXCLUDED.saldo_crac,
                saldo_edpymes = EXCLUDED.saldo_edpymes,
                saldo_total_tipo = EXCLUDED.saldo_total_tipo,
                saldo_total_directos = EXCLUDED.saldo_total_directos,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("creditos_dist.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_creditos_distrito",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
