"""Backfill V093 — marca como 'procesado' archivos ya ingestados.

Issue #18, G1. Antes de V093 + _import_file_with_audit, ningun importer
actualizaba raw.archivos_descargados.status='procesado' — quedaba en
'descargado' permanentemente. Este script lo corrige retroactivamente
inspeccionando si las tablas raw.<topico>_observacion tienen filas para
el (periodo, tipo_entidad) del archivo.

Heuristica conservadora: solo marca como procesado si encontramos
filas de OBSERVATION para ese (periodo, tipo_entidad). Si no, queda
como descargado y caera por el flujo normal de import.

Uso:
    uv run python scripts/backfill_v093_archivos_procesados.py [--dry-run]
"""

from __future__ import annotations

import argparse
import sys

import psycopg

from aibenchef_data.env import settings

# Mapeo topico -> (schema.tabla, columna_periodo, columna_tipo_entidad)
# Algunos archivos no son por tipo_entidad (ej. indicadores_prudenciales
# tienen scope global) — en esos casos pasamos None y comparamos solo
# por periodo.
TOPICO_TO_TABLE: dict[str, tuple[str, str, str | None]] = {
    "eeff": ("raw.eeff_observacion", "periodo", "tipo_entidad"),
    "oficinas": ("raw.oficinas_observacion", "periodo", "tipo_entidad"),
    "castigos": ("raw.castigos_observacion", "periodo", "tipo_entidad"),
    "colocaciones": ("raw.colocaciones_observacion", "periodo", "tipo_entidad"),
    "depositos": ("raw.depositos_observacion", "periodo", "tipo_entidad"),
    "personal": ("raw.personal_observacion", "periodo", "tipo_entidad"),
    "clientes_credito": ("raw.clientes_creditos", "periodo", "tipo_entidad"),
    "clientes_ahorro": ("raw.clientes_ahorros", "periodo", "tipo_entidad"),
    "indicadores": ("raw.indicadores_prudenciales", "periodo", None),
    "creditos_depositos_geo": ("raw.creditos_depositos_oficina", "periodo", None),
}

# Mapeo grupo (folder/disk) -> tipo_entidad (en raw.*_observacion).
GRUPO_TO_TIPO_ENTIDAD = {
    "banca_multiple": "BANCOS",
    "financiera": "FINANCIERAS",
    "cmac": "CMAC",
    "crac": "CRAC",
    "edpyme": "EDPYMES",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo contar cuantos archivos se marcarian, sin UPDATE.",
    )
    args = parser.parse_args()

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    total_updated = 0
    total_unknown_topico = 0
    total_no_data = 0

    with psycopg.connect(url, autocommit=False) as conn:
        with conn.cursor() as cur:
            # Listar archivos en status='descargado' que podrian estar procesados.
            cur.execute(
                """
                SELECT id, grupo, topico, periodo
                FROM raw.archivos_descargados
                WHERE status = 'descargado'
                ORDER BY periodo, grupo, topico
                """
            )
            archivos = cur.fetchall()

        print(f"# {len(archivos):,} archivos en estado 'descargado'")

        for archivo_id, grupo, topico, periodo in archivos:
            if topico not in TOPICO_TO_TABLE:
                total_unknown_topico += 1
                continue

            table, col_periodo, col_tipo_entidad = TOPICO_TO_TABLE[topico]
            tipo_entidad = GRUPO_TO_TIPO_ENTIDAD.get(grupo)

            with conn.cursor() as cur:
                if col_tipo_entidad and tipo_entidad:
                    cur.execute(
                        f"""
                        SELECT COUNT(*) FROM {table}
                        WHERE {col_periodo} = %s AND {col_tipo_entidad} = %s
                        LIMIT 1
                        """,
                        (periodo, tipo_entidad),
                    )
                else:
                    cur.execute(
                        f"""
                        SELECT COUNT(*) FROM {table}
                        WHERE {col_periodo} = %s
                        LIMIT 1
                        """,
                        (periodo,),
                    )
                n_rows = cur.fetchone()[0]

            if n_rows == 0:
                total_no_data += 1
                continue

            if args.dry_run:
                total_updated += 1
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE raw.archivos_descargados
                       SET status = 'procesado',
                           filas_insertadas = COALESCE(filas_insertadas, %s),
                           procesado_en = COALESCE(procesado_en, descargado_en),
                           actualizado_en = now()
                     WHERE id = %s
                       AND status = 'descargado'
                    """,
                    (n_rows, archivo_id),
                )
            total_updated += 1
            if total_updated % 100 == 0:
                conn.commit()
                print(f"  ... {total_updated:,} actualizados (commit parcial)")

        if not args.dry_run:
            conn.commit()

    print("")
    if args.dry_run:
        print(f"# DRY-RUN — {total_updated:,} archivos se marcarian como 'procesado'")
    else:
        print(f"# Marcados como 'procesado': {total_updated:,}")
    print(f"# Skipped (sin data en raw.*_observacion):  {total_no_data:,}")
    print(f"# Skipped (topico desconocido):              {total_unknown_topico:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
