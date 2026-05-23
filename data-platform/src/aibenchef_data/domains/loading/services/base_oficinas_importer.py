"""BaseOficinasImporter — carga CREDITOS Y DEPOSITOS POR OFICINAS.xlsx.

~1M filas — el archivo SBS mas grande del set. Optimizaciones:
- batch_size grande (20K)
- Solo columnas esenciales
- Sin re-lectura
"""

from __future__ import annotations

import time
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .base_helpers import normalizar_tipo, safe_text, to_int, to_numeric, to_periodo

log = get_logger(__name__)


class BaseOficinasImporter:
    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 20_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "DataSF") -> ImportResult:
        start = time.perf_counter()
        log.info("oficinas.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer {path}: {e}") from e

        df.columns = [str(c).strip() for c in df.columns]
        log.info("oficinas.import.read", filas=len(df), cols=len(df.columns))

        # Mapeo flexible — el archivo tiene caracteres latin-1 raros
        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "fecha":
                col_map["fecha"] = c
            elif cl == "empresa_sbs":
                col_map["empresa_sbs"] = c
            elif cl == "empresa":
                col_map["empresa"] = c
            elif "benchmark" in cl:
                col_map["benchmark"] = c
            elif cl == "tipo":
                col_map["tipo"] = c
            elif "clasifica" in cl and "50" not in cl:
                col_map["clasificacion"] = c
            elif cl == "departamento":
                col_map["depto"] = c
            elif cl == "provincia":
                col_map["provincia"] = c
            elif cl == "distrito":
                col_map["distrito"] = c
            elif "departamento_distrito" in cl:
                col_map["depto_dist"] = c
            elif "digo de oficina" in cl or "codigo de oficina" in cl:
                col_map["cod_oficina"] = c
            elif cl == "mn":
                col_map["mn"] = c
            elif cl == "me":
                col_map["me"] = c
            elif cl == "total":
                col_map["total"] = c
            elif cl == "producto":
                col_map["producto"] = c
            elif "caqp" in cl and "s/p" not in cl:
                col_map["region"] = c
            elif "caqp" in cl and "s/p" in cl:
                col_map["region_sp"] = c
            elif "cb" in cl or "50" in cl:
                col_map["cb50"] = c

        required = ["fecha", "empresa_sbs", "depto", "producto"]
        missing = [r for r in required if r not in col_map]
        if missing:
            raise ValidationError(f"Cols faltantes: {missing}. Tengo: {df.columns.tolist()[:10]}")

        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        log.info("oficinas.import.parsing_start")
        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get(col_map["fecha"]))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa_sbs = safe_text(row.get(col_map["empresa_sbs"]))
                depto = safe_text(row.get(col_map["depto"]))
                producto = safe_text(row.get(col_map["producto"]))
                if not empresa_sbs or not depto or not producto:
                    skipped += 1
                    continue

                depto_dist = safe_text(row.get(col_map.get("depto_dist")))
                # Si no viene, construirlo
                if not depto_dist:
                    distrito = safe_text(row.get(col_map.get("distrito"))) or "(sin)"
                    depto_dist = f"{depto}_{distrito}"

                rows.append((
                    periodo, fc,
                    empresa_sbs,
                    safe_text(row.get(col_map.get("empresa"))),
                    safe_text(row.get(col_map.get("benchmark"))),
                    normalizar_tipo(safe_text(row.get(col_map.get("tipo")))),
                    safe_text(row.get(col_map.get("clasificacion"))),
                    safe_text(row.get(col_map.get("cb50"))),
                    depto,
                    safe_text(row.get(col_map.get("provincia"))),
                    safe_text(row.get(col_map.get("distrito"))),
                    depto_dist,
                    safe_text(row.get(col_map.get("region"))),
                    safe_text(row.get(col_map.get("region_sp"))),
                    to_int(row.get(col_map.get("cod_oficina"))),
                    producto,
                    to_numeric(row.get(col_map.get("mn"))),
                    to_numeric(row.get(col_map.get("me"))),
                    to_numeric(row.get(col_map.get("total"))),
                    path.name,
                ))

                # Log progress cada 100K
                if len(rows) % 100_000 == 0:
                    log.info("oficinas.import.parsing_progress", rows=len(rows))
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("oficinas.import.parsed", rows=len(rows), skipped=skipped)

        if not rows:
            return ImportResult(
                source="base_oficinas", source_file=path.name,
                rows_inserted=0, rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.creditos_depositos_oficina (
                periodo, fecha_cierre, empresa_sbs, empresa, empresa_benchmark,
                tipo_entidad, clasificacion, mayor_50_pct_cb,
                departamento, provincia, distrito, departamento_distrito,
                region_caqp, region_caqp_sp, codigo_oficina,
                producto, saldo_mn, saldo_me, saldo_total, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa_sbs, codigo_oficina, producto, departamento_distrito)
            DO UPDATE SET
                empresa = EXCLUDED.empresa,
                empresa_benchmark = EXCLUDED.empresa_benchmark,
                tipo_entidad = EXCLUDED.tipo_entidad,
                mayor_50_pct_cb = EXCLUDED.mayor_50_pct_cb,
                provincia = EXCLUDED.provincia,
                distrito = EXCLUDED.distrito,
                region_caqp = EXCLUDED.region_caqp,
                region_caqp_sp = EXCLUDED.region_caqp_sp,
                saldo_mn = EXCLUDED.saldo_mn,
                saldo_me = EXCLUDED.saldo_me,
                saldo_total = EXCLUDED.saldo_total,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        # Commit por batch para no mantener una transaccion gigante que
        # el server pueda cerrar por timeout. UPSERT es idempotente asi
        # que si se interrumpe, podemos re-correr y solo se actualizan
        # las filas ya presentes.
        for i in range(0, len(rows), self._batch_size):
            batch = rows[i:i + self._batch_size]
            async with self._conn.cursor() as cur:
                await cur.executemany(sql, batch)
            await self._conn.commit()
            inserted += len(batch)
            if inserted % 100_000 == 0 or inserted == len(rows):
                log.info(
                    "oficinas.import.batch_ok",
                    total=inserted,
                    pct=round(inserted / len(rows) * 100, 1),
                )

        return ImportResult(
            source="base_oficinas", source_file=path.name,
            rows_inserted=inserted, rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
