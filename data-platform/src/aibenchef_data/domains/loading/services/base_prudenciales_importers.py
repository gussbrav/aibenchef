"""Importers de indicadores prudenciales SBS:
- BasePatrimonioImporter (BASE PATRIMONIO EFECTIVO.xlsx)
- BaseRatioLiquidezImporter (BASE_RATIO_LIQUIDEZ.xlsx)
- BaseRcgImporter (BASE_RCG.xlsx)
- BasePersonalImporter (BASE PERSONAL.xlsx)

Todos comparten estructura: leen hoja "Data" / "Base" en formato tidy,
normalizan tipo_entidad, hacen UPSERT idempotente.
"""

from __future__ import annotations

import time
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .base_helpers import normalizar_tipo, safe_text, to_int, to_numeric, to_periodo

log = get_logger(__name__)


def _read_excel(path: Path, sheet: str):
    try:
        import pandas as pd
    except ImportError as e:
        raise ValidationError(f"pandas no instalado: {e}") from e
    try:
        df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
    except Exception as e:
        raise ValidationError(f"No se pudo leer hoja '{sheet}' de {path}: {e}") from e
    df.columns = [str(c).strip() for c in df.columns]
    return df


class BasePatrimonioImporter:
    """Carga BASE PATRIMONIO EFECTIVO.xlsx hoja 'Data'."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 5_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "Data") -> ImportResult:
        start = time.perf_counter()
        log.info("patrimonio.import.start", path=str(path))
        df = _read_excel(path, sheet)
        log.info("patrimonio.import.read", filas=len(df))

        # Columnas esperadas: PERIODO, Empresas, Tipo, Nivel_1, Nivel_2, Nivel_3, Total, Nivel_1_Soles
        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get("PERIODO"))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = safe_text(row.get("Empresas"))
                if not empresa:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa,
                        normalizar_tipo(safe_text(row.get("Tipo"))),
                        to_numeric(row.get("Nivel_1")),
                        to_numeric(row.get("Nivel_2")),
                        to_numeric(row.get("Nivel_3")),
                        to_numeric(row.get("Total")),
                        to_numeric(row.get("Nivel_1_Soles")),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        if not rows:
            return ImportResult(
                source="base_patrimonio",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.patrimonio_efectivo (
                periodo, fecha_cierre, empresa, tipo_entidad,
                nivel_1_pct, nivel_2_pct, nivel_3_pct,
                pe_total, pe_nivel_1_soles, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa) DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                nivel_1_pct = EXCLUDED.nivel_1_pct,
                nivel_2_pct = EXCLUDED.nivel_2_pct,
                nivel_3_pct = EXCLUDED.nivel_3_pct,
                pe_total = EXCLUDED.pe_total,
                pe_nivel_1_soles = EXCLUDED.pe_nivel_1_soles,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("patrimonio.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_patrimonio",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )


class BaseRatioLiquidezImporter:
    """Carga BASE_RATIO_LIQUIDEZ.xlsx hoja 'Data'."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 5_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "Data") -> ImportResult:
        start = time.perf_counter()
        log.info("liquidez.import.start", path=str(path))
        df = _read_excel(path, sheet)
        log.info("liquidez.import.read", filas=len(df))

        # Cols: PERIODO, Tipo, Empresas, Activo, Pasivo, RL, ActivoE, PasivoE, RLE
        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get("PERIODO"))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = safe_text(row.get("Empresas"))
                if not empresa:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa,
                        normalizar_tipo(safe_text(row.get("Tipo"))),
                        to_numeric(row.get("Activo")),
                        to_numeric(row.get("Pasivo")),
                        to_numeric(row.get("RL")),
                        to_numeric(row.get("ActivoE")),
                        to_numeric(row.get("PasivoE")),
                        to_numeric(row.get("RLE")),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        if not rows:
            return ImportResult(
                source="base_ratio_liquidez",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.ratio_liquidez (
                periodo, fecha_cierre, empresa, tipo_entidad,
                activo_mn, pasivo_mn, rl_mn,
                activo_me, pasivo_me, rl_me,
                source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa) DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                activo_mn = EXCLUDED.activo_mn,
                pasivo_mn = EXCLUDED.pasivo_mn,
                rl_mn = EXCLUDED.rl_mn,
                activo_me = EXCLUDED.activo_me,
                pasivo_me = EXCLUDED.pasivo_me,
                rl_me = EXCLUDED.rl_me,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("liquidez.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_ratio_liquidez",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )


class BaseRcgImporter:
    """Carga BASE_RCG.xlsx hoja 'DATA' (Ratio de Capital Global - Basilea III)."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 5_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "DATA") -> ImportResult:
        start = time.perf_counter()
        log.info("rcg.import.start", path=str(path))
        df = _read_excel(path, sheet)
        log.info("rcg.import.read", filas=len(df))

        # Cols: PERIODO, Tipo, Empresas, Creditos, Mercado, Operacional, Total,
        # Creditos_A, Mercado_A, Operacional_A, Total_A, Patrimonio, RCG
        rows: list[tuple] = []
        skipped = 0
        errors: list[str] = []

        for idx, row in df.iterrows():
            try:
                pi = to_periodo(row.get("PERIODO"))
                if not pi:
                    skipped += 1
                    continue
                periodo, fc = pi
                empresa = safe_text(row.get("Empresas"))
                if not empresa:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa,
                        normalizar_tipo(safe_text(row.get("Tipo"))),
                        to_numeric(row.get("Creditos")),
                        to_numeric(row.get("Mercado")),
                        to_numeric(row.get("Operacional")),
                        to_numeric(row.get("Total")),
                        to_numeric(row.get("Creditos_A")),
                        to_numeric(row.get("Mercado_A")),
                        to_numeric(row.get("Operacional_A")),
                        to_numeric(row.get("Total_A")),
                        to_numeric(row.get("Patrimonio")),
                        to_numeric(row.get("RCG")),
                        path.name,
                    )
                )
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        if not rows:
            return ImportResult(
                source="base_rcg",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.ratio_capital_global (
                periodo, fecha_cierre, empresa, tipo_entidad,
                apr_credito, apr_mercado, apr_operacional, apr_total,
                apr_credito_adic, apr_mercado_adic, apr_operacional_adic, apr_total_adic,
                patrimonio_efectivo, rcg_pct, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa) DO UPDATE SET
                tipo_entidad = EXCLUDED.tipo_entidad,
                apr_credito = EXCLUDED.apr_credito,
                apr_mercado = EXCLUDED.apr_mercado,
                apr_operacional = EXCLUDED.apr_operacional,
                apr_total = EXCLUDED.apr_total,
                apr_credito_adic = EXCLUDED.apr_credito_adic,
                apr_mercado_adic = EXCLUDED.apr_mercado_adic,
                apr_operacional_adic = EXCLUDED.apr_operacional_adic,
                apr_total_adic = EXCLUDED.apr_total_adic,
                patrimonio_efectivo = EXCLUDED.patrimonio_efectivo,
                rcg_pct = EXCLUDED.rcg_pct,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("rcg.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_rcg",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )


class BasePersonalImporter:
    """Carga BASE PERSONAL.xlsx hoja 'Base' (headcount por entidad)."""

    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 5_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "Base") -> ImportResult:
        start = time.perf_counter()
        log.info("personal.import.start", path=str(path))
        df = _read_excel(path, sheet)
        log.info("personal.import.read", filas=len(df))

        # Mapeo flexible por contenido de la columna
        col_map: dict[str, str] = {}
        for c in df.columns:
            cl = c.lower()
            if cl == "fecha":
                col_map["fecha"] = c
            elif "tipo" in cl and "entidad" in cl:
                col_map["tipo_entidad"] = c
            elif "microfinan" in cl:
                col_map["microfin"] = c
            elif cl == "nacional":
                col_map["nacional"] = c
            elif "empresas sbs" in cl or "empresa sbs" in cl:
                col_map["empresa_sbs"] = c
            elif "empresa bd" in cl:
                col_map["empresa_bd"] = c
            elif cl == "gerentes":
                col_map["gerentes"] = c
            elif cl == "funcionarios":
                col_map["funcionarios"] = c
            elif cl == "empleados":
                col_map["empleados"] = c
            elif cl == "otros":
                col_map["otros"] = c
            elif cl == "total":
                col_map["total"] = c
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
                empresa_sbs = safe_text(row.get(col_map.get("empresa_sbs")))
                if not empresa_sbs:
                    skipped += 1
                    continue
                rows.append(
                    (
                        periodo,
                        fc,
                        empresa_sbs,
                        safe_text(row.get(col_map.get("empresa_bd"))),
                        normalizar_tipo(safe_text(row.get(col_map.get("tipo_entidad")))),
                        safe_text(row.get(col_map.get("microfin"))),
                        safe_text(row.get(col_map.get("nacional"))),
                        safe_text(row.get(col_map.get("mype50"))),
                        to_int(row.get(col_map.get("gerentes"))),
                        to_int(row.get(col_map.get("funcionarios"))),
                        to_int(row.get(col_map.get("empleados"))),
                        to_int(row.get(col_map.get("otros"))),
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
                source="base_personal",
                source_file=path.name,
                rows_inserted=0,
                rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.personal_observacion (
                periodo, fecha_cierre, empresa_sbs, empresa_bd, tipo_entidad,
                microfinanciera, nacional, mayor_50_pct_mype,
                gerentes, funcionarios, empleados, otros, total, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa_sbs) DO UPDATE SET
                empresa_bd = EXCLUDED.empresa_bd,
                tipo_entidad = EXCLUDED.tipo_entidad,
                microfinanciera = EXCLUDED.microfinanciera,
                nacional = EXCLUDED.nacional,
                mayor_50_pct_mype = EXCLUDED.mayor_50_pct_mype,
                gerentes = EXCLUDED.gerentes,
                funcionarios = EXCLUDED.funcionarios,
                empleados = EXCLUDED.empleados,
                otros = EXCLUDED.otros,
                total = EXCLUDED.total,
                source_file = EXCLUDED.source_file,
                loaded_at = now()
        """
        inserted = 0
        async with self._conn.cursor() as cur:
            for i in range(0, len(rows), self._batch_size):
                batch = rows[i : i + self._batch_size]
                await cur.executemany(sql, batch)
                inserted += len(batch)
                log.info("personal.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_personal",
            source_file=path.name,
            rows_inserted=inserted,
            rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
