"""Re-procesa archivos en estado 'descargado' tras un fix del parser.

Uso:
    uv run python scripts/reingest_pending.py <topico>

topico ∈ {castigos, clientes_credito, clientes_ahorro, colocaciones, depositos, eeff}
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# psycopg async no soporta ProactorEventLoop en Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import psycopg

from aibenchef_data.env import settings
from aibenchef_data.infrastructure.db import close_pool, connection, open_pool


IMPORTERS = {
    "castigos": ("aibenchef_data.domains.loading", "MonthlyCastigosImporter"),
    "clientes_credito": ("aibenchef_data.domains.loading", "MonthlyClientesImporter"),
    "clientes_ahorro": ("aibenchef_data.domains.loading", "MonthlyClientesAhorroImporter"),
    "colocaciones": ("aibenchef_data.domains.loading", "MonthlyColocacionesImporter"),
    "depositos": ("aibenchef_data.domains.loading", "MonthlyDepositosImporter"),
    "eeff": ("aibenchef_data.domains.loading", "MonthlyEeffImporter"),
    "oficinas": ("aibenchef_data.domains.loading", "MonthlyOficinasImporter"),
}


def _fetch_pending(topico: str) -> list[Path]:
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT path_local
                FROM raw.archivos_descargados
                WHERE topico = %s AND status = 'descargado'
                ORDER BY anio, mes
                """,
                (topico,),
            )
            return [Path(row[0]) for row in cur.fetchall()]


def _mark_procesado(paths: list[Path]) -> int:
    if not paths:
        return 0
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE raw.archivos_descargados
                SET status = 'procesado',
                    procesado_en = NOW(),
                    actualizado_en = NOW(),
                    error_mensaje = NULL
                WHERE path_local = ANY(%s) AND status = 'descargado'
                """,
                ([str(p) for p in paths],),
            )
            n = cur.rowcount
        conn.commit()
    return n


def _mark_error(path: Path, msg: str) -> None:
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE raw.archivos_descargados
                SET error_mensaje = %s, actualizado_en = NOW()
                WHERE path_local = %s
                """,
                (msg[:500], str(path)),
            )
        conn.commit()


async def _run(topico: str) -> None:
    if topico not in IMPORTERS:
        print(f"Topico desconocido: {topico}. Opciones: {list(IMPORTERS)}")
        sys.exit(2)

    mod_name, cls_name = IMPORTERS[topico]
    mod = __import__(mod_name, fromlist=[cls_name])
    importer_cls = getattr(mod, cls_name)

    files = _fetch_pending(topico)
    print(f"# {len(files)} archivos pendientes en {topico}")
    if not files:
        return

    await open_pool()
    ok_paths: list[Path] = []
    total_inserted = 0
    total_err = 0
    try:
        async with connection() as conn:
            importer = importer_cls(conn, batch_size=1000)
            for i, f in enumerate(files, start=1):
                if not f.exists():
                    print(f"  [{i:>4}/{len(files)}] {f.name:<40} SKIP (no existe)")
                    continue
                try:
                    result = await importer.import_file(f)
                    if result.errors:
                        total_err += len(result.errors)
                        first = str(result.errors[0])[:200]
                        print(
                            f"  [{i:>4}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5} ERR x{len(result.errors)}: {first}"
                        )
                        _mark_error(f, first)
                    else:
                        total_inserted += result.rows_inserted
                        ok_paths.append(f)
                        if i % 20 == 0 or result.rows_inserted > 0:
                            print(
                                f"  [{i:>4}/{len(files)}] {f.name:<40} "
                                f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  OK"
                            )
                except Exception as e:
                    total_err += 1
                    msg = f"{type(e).__name__}: {e}"
                    print(f"  [{i:>4}/{len(files)}] {f.name:<40} FATAL: {msg[:120]}")
                    _mark_error(f, msg)
                    try:
                        await conn.rollback()
                    except Exception:
                        pass
    finally:
        await close_pool()

    n = _mark_procesado(ok_paths)
    print("")
    print(f"# TOTAL {topico}: {total_inserted:,} filas insertadas, {total_err} errores, {n} marcados procesado")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    asyncio.run(_run(sys.argv[1]))


if __name__ == "__main__":
    main()
