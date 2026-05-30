"""Backfill raw.archivo_contenido — vuelca el grid de TODOS los .xls SBS
descargados a una tabla universal para el Inspector de Tópicos.

Issue #65. Permite al Inspector mostrar el contenido crudo del archivo
lado a lado con las tablas raw procesadas, sin modificar los 9 importers
especificos.

Estrategia:
    1. Lista archivos en raw.archivos_descargados (filtrable por topico/periodo/grupo).
    2. Para cada archivo:
       a. Leer .xls con read_xls() universal (BIFF/OOXML/HTML/XML/XLSB).
       b. Iterar TODAS las celdas no vacias (sheet_idx, fila, columna, valor).
       c. UPSERT a raw.archivo_contenido.
    3. Salta archivos cuyo path_local no existe (path es del container).

Uso:
    uv run python scripts/dump_archivo_contenido.py --topico oficinas --periodo 202603
    uv run python scripts/dump_archivo_contenido.py --topico oficinas
    uv run python scripts/dump_archivo_contenido.py
    uv run python scripts/dump_archivo_contenido.py --dry-run --topico oficinas

Performance:
    ~50-200ms por archivo. 1000 archivos = ~3-5 min total.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import psycopg

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.env import settings

# Una celda demasiado larga (mas de 8KB) probablemente es texto mal leido
# o formula con error — la truncamos a 8000 chars para no romper indexes.
MAX_VALOR_TEXT = 8000


def _coerce_numero(v: object) -> float | None:
    """Si el valor es numerico (int, float, str que parsea a numero), retorna
    float. Sino None. Aceptamos numero negativo / decimal / cientifico."""
    if isinstance(v, bool):
        return None  # bool no es numero util
    if isinstance(v, (int, float)):
        try:
            f = float(v)
            if f != f or f == float("inf") or f == float("-inf"):
                return None
            return f
        except (TypeError, OverflowError):
            return None
    return None


def listar_archivos(
    conn,
    *,
    topico: str | None,
    periodo: int | None,
    grupo: str | None,
) -> list[tuple[str, str, str]]:
    """Retorna list of (archivo_id, path_local, nombre_archivo)."""
    sql = """
        SELECT id::text, path_local, nombre_archivo
        FROM raw.archivos_descargados
        WHERE path_local IS NOT NULL
    """
    args: list = []
    if topico:
        sql += " AND topico = %s"
        args.append(topico)
    if periodo:
        sql += " AND periodo = %s"
        args.append(periodo)
    if grupo:
        sql += " AND grupo = %s"
        args.append(grupo)
    sql += " ORDER BY periodo DESC, grupo, nombre_archivo"
    with conn.cursor() as cur:
        cur.execute(sql, args)
        return [(r[0], r[1], r[2]) for r in cur.fetchall()]


def archivo_ya_dumpeado(conn, archivo_id: str) -> bool:
    """True si ya hay celdas para este archivo en archivo_contenido."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM raw.archivo_contenido WHERE archivo_id = %s LIMIT 1)",
            (archivo_id,),
        )
        return cur.fetchone()[0]


def dump_archivo(conn, archivo_id: str, path: Path) -> int:
    """Lee el .xls y vuelca todas sus celdas no vacias a archivo_contenido.
    Retorna numero de celdas insertadas."""
    sheets = read_xls(path)
    batch: list[tuple] = []
    for sheet_idx, sheet in enumerate(sheets):
        for r in range(sheet.n_rows):
            for c in range(min(sheet.n_cols, len(sheet.rows[r]))):
                v = sheet.cell(r, c)
                if v is None:
                    continue
                # Skip strings vacios o solo whitespace
                if isinstance(v, str) and not v.strip():
                    continue
                valor_text = str(v).strip() if isinstance(v, str) else str(v)
                if len(valor_text) > MAX_VALOR_TEXT:
                    valor_text = valor_text[:MAX_VALOR_TEXT]
                valor_num = _coerce_numero(v)
                batch.append((archivo_id, sheet_idx, sheet.name, r, c, valor_text, valor_num))

    if not batch:
        return 0

    # UPSERT por unique (archivo_id, sheet_idx, fila, columna)
    with conn.cursor() as cur:
        # Borrar primero por simplicidad (en lugar de upsert, evita conflicts
        # con sheet_name cambiando entre re-runs).
        cur.execute("DELETE FROM raw.archivo_contenido WHERE archivo_id = %s", (archivo_id,))
        cur.executemany(
            """
            INSERT INTO raw.archivo_contenido
                (archivo_id, sheet_idx, sheet_name, fila, columna, valor_text, valor_numero)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            batch,
        )
    return len(batch)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--topico", type=str, default=None, help="Filtrar por topico (eeff, oficinas, etc)."
    )
    parser.add_argument("--periodo", type=int, default=None, help="Filtrar por periodo YYYYMM.")
    parser.add_argument(
        "--grupo", type=str, default=None, help="Filtrar por grupo (banca_multiple, cmac, etc)."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Solo listar archivos que se dumpearian."
    )
    parser.add_argument(
        "--skip-existing", action="store_true", help="Saltar archivos ya dumpeados."
    )
    args = parser.parse_args()

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url, connect_timeout=10) as conn:
        archivos = listar_archivos(conn, topico=args.topico, periodo=args.periodo, grupo=args.grupo)

    if not archivos:
        print("# No hay archivos que matchean los filtros")
        return 0

    print(f"# {len(archivos)} archivos a dumpear")

    if args.dry_run:
        for _aid, path, name in archivos[:20]:
            print(f"  [DRY] {name}  ({path})")
        if len(archivos) > 20:
            print(f"  ... y {len(archivos) - 20} mas")
        return 0

    ok = 0
    skipped = 0
    failed = 0
    total_celdas = 0
    with psycopg.connect(url, connect_timeout=30) as conn:
        for i, (aid, path_str, name) in enumerate(archivos, 1):
            path = Path(path_str)
            if not path.exists():
                print(f"  [{i}/{len(archivos)}] SKIP no existe: {path_str}", file=sys.stderr)
                skipped += 1
                continue
            if args.skip_existing and archivo_ya_dumpeado(conn, aid):
                skipped += 1
                continue
            try:
                n_celdas = dump_archivo(conn, aid, path)
                conn.commit()
                total_celdas += n_celdas
                ok += 1
                if i % 25 == 0 or i == len(archivos):
                    print(
                        f"  [{i}/{len(archivos)}] {name}: {n_celdas} celdas — total acum {total_celdas:,}",
                        flush=True,
                    )
            except Exception as exc:
                conn.rollback()
                failed += 1
                print(
                    f"  [{i}/{len(archivos)}] ERROR {name}: {type(exc).__name__}: {exc}",
                    file=sys.stderr,
                )

    print(
        f"\n# Dump finalizado: {ok} ok, {failed} fallidos, {skipped} skipped, "
        f"{total_celdas:,} celdas totales"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
