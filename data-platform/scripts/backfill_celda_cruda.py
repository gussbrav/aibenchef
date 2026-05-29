"""Backfill raw.eeff_celda_cruda — re-corre import de N periodos recientes (issue #65).

La tabla raw.eeff_celda_cruda nace vacia con V113. Para que el EEFF Inspector
pueda mostrar la comparacion extraido-vs-archivo en periodos historicos, hay
que re-correr el import de esos periodos. El import es idempotente (UPSERT
tanto en raw.eeff_observacion como en raw.eeff_celda_cruda).

Estrategia:
    1. Busca los ultimos N periodos con archivos EEFF descargados.
    2. Para cada periodo + grupo, busca el archivo en raw.archivos_descargados.
    3. Re-corre el importer con archivo_id resuelto.

Uso:
    uv run python scripts/backfill_celda_cruda.py --periodos 6
    uv run python scripts/backfill_celda_cruda.py --periodo 202604 --grupo cmac
    uv run python scripts/backfill_celda_cruda.py --dry-run --periodos 3
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import psycopg

from aibenchef_data.domains.loading.services.monthly_eeff_importer import MonthlyEeffImporter
from aibenchef_data.env import settings
from aibenchef_data.infrastructure.db import connection

GRUPO_TO_TIPO_ENTIDAD = {
    "banca_multiple": "BANCOS",
    "financiera": "FINANCIERAS",
    "cmac": "CMAC",
    "crac": "CRAC",
    "edpyme": "EDPYMES",
}


def list_recent_periodos(n: int) -> list[int]:
    """Ultimos N periodos con archivos EEFF descargados."""
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT periodo
            FROM raw.archivos_descargados
            WHERE topico = 'eeff' AND path_local IS NOT NULL
            ORDER BY periodo DESC
            LIMIT %s
            """,
            (n,),
        )
        return [int(r[0]) for r in cur.fetchall()]


def list_archivos(periodos: list[int], grupo: str | None) -> list[tuple[str, int, str, str]]:
    """Devuelve (archivo_id, periodo, grupo, path_local) por archivo EEFF."""
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        if grupo:
            cur.execute(
                """
                SELECT id::text, periodo, grupo, path_local
                FROM raw.archivos_descargados
                WHERE topico = 'eeff'
                  AND periodo = ANY(%s)
                  AND grupo = %s
                  AND path_local IS NOT NULL
                ORDER BY periodo DESC, grupo
                """,
                (periodos, grupo),
            )
        else:
            cur.execute(
                """
                SELECT id::text, periodo, grupo, path_local
                FROM raw.archivos_descargados
                WHERE topico = 'eeff'
                  AND periodo = ANY(%s)
                  AND path_local IS NOT NULL
                ORDER BY periodo DESC, grupo
                """,
                (periodos,),
            )
        return [(r[0], int(r[1]), r[2], r[3]) for r in cur.fetchall()]


async def reimport_one(archivo_id: str, path_local: str, tipo_entidad: str) -> int:
    """Re-importa un archivo. Devuelve rows_inserted en eeff_observacion."""
    p = Path(path_local)
    if not p.exists():
        print(f"  [SKIP] No existe: {path_local}", file=sys.stderr)
        return 0
    async with connection() as conn:
        importer = MonthlyEeffImporter(conn)
        result = await importer.import_file(p, tipo_entidad=tipo_entidad, archivo_id=archivo_id)
        return result.rows_inserted


async def main_async(periodos: list[int], grupo: str | None, dry_run: bool) -> int:
    archivos = list_archivos(periodos, grupo)
    if not archivos:
        print(
            f"# No hay archivos EEFF en periodos {periodos}" + (f" grupo={grupo}" if grupo else "")
        )
        return 0

    print(
        f"# {len(archivos)} archivos a re-importar (periodos: {sorted(set(p for _, p, _, _ in archivos))})"
    )

    if dry_run:
        for aid, periodo, g, path in archivos:
            print(f"  [DRY] {periodo} {g:<14} {Path(path).name}  (archivo_id={aid[:8]}...)")
        return 0

    total_obs = 0
    failed = 0
    for i, (aid, periodo, g, path) in enumerate(archivos, 1):
        tipo_entidad = GRUPO_TO_TIPO_ENTIDAD.get(g)
        if not tipo_entidad:
            print(f"  [{i}/{len(archivos)}] [SKIP] grupo desconocido: {g}")
            continue
        print(f"  [{i}/{len(archivos)}] {periodo} {g:<14} {Path(path).name}", flush=True)
        try:
            n = await reimport_one(aid, path, tipo_entidad)
            total_obs += n
            print(f"      OK rows_obs={n}")
        except Exception as exc:
            failed += 1
            print(f"      ERROR {type(exc).__name__}: {exc}")

    print(
        f"\n# Re-import finalizado: {len(archivos) - failed} ok, {failed} fallidos, {total_obs} obs upserted"
    )
    return 0 if failed == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument(
        "--periodos",
        type=int,
        help="Cantidad de periodos recientes a re-importar (ej. 6).",
    )
    g.add_argument(
        "--periodo",
        type=int,
        help="Periodo unico YYYYMM (ej. 202604).",
    )
    parser.add_argument(
        "--grupo",
        choices=list(GRUPO_TO_TIPO_ENTIDAD.keys()),
        default=None,
        help="Filtrar por grupo (banca_multiple, cmac, etc). Default = todos.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo listar archivos que se re-importarian, sin tocar la DB.",
    )
    args = parser.parse_args()

    periodos = [args.periodo] if args.periodo else list_recent_periodos(args.periodos)
    if not periodos:
        print("# No hay periodos para procesar", file=sys.stderr)
        return 1

    return asyncio.run(main_async(periodos, args.grupo, args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
