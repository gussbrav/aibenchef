"""BaseTasasActivasImporter — carga BASE TASAS ACTIVAS.xlsx hoja 'Data'.

El archivo es wide: 5 dim cols + 46 cols de tasas (segmento × plazo).
Hacemos UNPIVOT a long format antes de insertar.

Segmentos detectados:
- Corporativos, Grandes Empresas, Medianas Empresas, Pequenas Empresas,
- Microempresas, Consumo, Hipotecarios

Dentro de cada segmento, columnas con sufijo .N (.1, .2, ...) son distintos
plazos del MISMO segmento. La columna sin sufijo es el "header" del bloque
(ej "Corporativos") y sus columnas siguientes son los plazos.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import ValidationError, get_logger

from ..entities.import_result import ImportResult
from .base_helpers import normalizar_tipo, safe_text, to_numeric, to_periodo

log = get_logger(__name__)


# Columnas que NO son tasas (son dimensiones)
_DIM_COLS_LOWER = {
    "fecha", "tipo de entidad", "microfinanciera",
    "nombre sbs", "nomb_correg",
}


# Segmentos canonicos en el orden en que aparecen en el archivo
_SEGMENTOS_HEADERS = [
    "Corporativos",
    "Grandes Empresas",
    "Medianas Empresas",
    "Pequenas Empresas",
    "Pequeñas Empresas",   # variante con tilde
    "Microempresas",
    "Consumo",
    "Hipotecarios",
]


def _build_segment_map(columns: list[str]) -> dict[str, str]:
    """Devuelve {col_excel: segmento_canonico} para cada col que NO es dim.

    Logica: recorremos columnas en orden. Cuando encontramos un nombre que
    coincide con un segmento header (Corporativos, Grandes Empresas, etc),
    actualizamos el segmento "actual" y todas las siguientes cols van a ese
    segmento hasta encontrar otro header.

    La columna del segmento header en si mismo NO se mapea (es solo divisor).
    """
    mapping: dict[str, str] = {}
    current_segment: str | None = None
    seg_set = {s.lower() for s in _SEGMENTOS_HEADERS}

    for c in columns:
        cl = c.lower().strip()
        if cl in _DIM_COLS_LOWER:
            continue
        # Quitar sufijo .N para detectar header
        base_name = re.sub(r"\.\d+$", "", c).strip()
        if base_name.lower() in seg_set:
            # Es un segmento header
            current_segment = base_name
            # El header en si NO se mapea como tasa (las sub-cols ya tienen
            # nombres semánticos como "Descuentos" o "Préstamos hasta 30 días")
            # PERO ojo: si el header trae UN VALOR, debe tomarse como tasa
            # promedio del segmento. Marcamos para incluir como tipo_operacion='Promedio'
            mapping[c] = f"{current_segment}|Promedio"
        elif current_segment is not None:
            # Es una sub-col dentro del segmento actual
            tipo_op = base_name  # quitamos sufijo
            mapping[c] = f"{current_segment}|{tipo_op}"
        # else: no estamos en un segmento todavia -> skip

    return mapping


class BaseTasasActivasImporter:
    def __init__(self, conn: psycopg.AsyncConnection, *, batch_size: int = 10_000) -> None:
        self._conn = conn
        self._batch_size = batch_size

    async def import_file(self, path: Path, *, sheet: str = "Data") -> ImportResult:
        start = time.perf_counter()
        log.info("tasas_act.import.start", path=str(path))

        try:
            import pandas as pd
        except ImportError as e:
            raise ValidationError(f"pandas no instalado: {e}") from e

        try:
            df = pd.read_excel(path, sheet_name=sheet, engine="openpyxl")
        except Exception as e:
            raise ValidationError(f"No se pudo leer {path}: {e}") from e

        df.columns = [str(c).strip() for c in df.columns]
        log.info("tasas_act.import.read", filas=len(df), cols=len(df.columns))

        # Build segment mapping
        seg_map = _build_segment_map(list(df.columns))
        log.info("tasas_act.import.segmented", n_tasas_cols=len(seg_map))

        # Detectar cols dim
        col_fecha = None
        col_tipo = None
        col_microfin = None
        col_nombre_sbs = None
        col_nomb_correg = None
        for c in df.columns:
            cl = c.lower().strip()
            if cl == "fecha":
                col_fecha = c
            elif cl == "tipo de entidad":
                col_tipo = c
            elif cl == "microfinanciera":
                col_microfin = c
            elif cl == "nombre sbs":
                col_nombre_sbs = c
            elif cl == "nomb_correg":
                col_nomb_correg = c

        if not col_fecha or not col_tipo or not col_nombre_sbs:
            raise ValidationError(
                f"Columnas dim faltantes. Disponibles: {df.columns.tolist()[:10]}"
            )

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
                empresa = safe_text(row.get(col_nombre_sbs))
                if not empresa:
                    skipped += 1
                    continue

                tipo = normalizar_tipo(safe_text(row.get(col_tipo)))
                microfin = safe_text(row.get(col_microfin)) if col_microfin else None
                nomb_correg = safe_text(row.get(col_nomb_correg)) if col_nomb_correg else None

                # Unpivot
                for col, segmento_tipo_op in seg_map.items():
                    tasa = to_numeric(row.get(col))
                    if tasa is None:
                        continue
                    seg, top = segmento_tipo_op.split("|", 1)
                    rows.append((
                        periodo, fc, empresa, nomb_correg, tipo, microfin,
                        seg, top, tasa,
                        path.name,
                    ))
            except Exception as e:
                errors.append(f"row {idx}: {e}")
                if len(errors) > 100:
                    break

        log.info("tasas_act.import.parsed", rows=len(rows), skipped=skipped)

        if not rows:
            return ImportResult(
                source="base_tasas_activas", source_file=path.name,
                rows_inserted=0, rows_skipped=skipped,
                duration_seconds=time.perf_counter() - start,
                errors=tuple(errors),
            )

        sql = """
            INSERT INTO raw.tasas_activas (
                periodo, fecha_cierre, empresa_sbs, nomb_correg, tipo_entidad, microfinanciera,
                segmento_credito, tipo_operacion, tasa_pct, source_file
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (periodo, empresa_sbs, segmento_credito, tipo_operacion) DO UPDATE SET
                nomb_correg = EXCLUDED.nomb_correg,
                tipo_entidad = EXCLUDED.tipo_entidad,
                microfinanciera = EXCLUDED.microfinanciera,
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
                log.info("tasas_act.import.batch_ok", total=inserted)

        return ImportResult(
            source="base_tasas_activas", source_file=path.name,
            rows_inserted=inserted, rows_skipped=skipped,
            duration_seconds=time.perf_counter() - start,
            errors=tuple(errors),
        )
