"""CLI principal de Aibenchef data platform.

Ejemplos:
    aibenchef --help
    aibenchef catalog list-entidades --grupo cmac
    aibenchef catalog show-topicos
    aibenchef catalog periodo 202404
    aibenchef scrape --periodo 202404
    aibenchef scrape --periodo 202404 --grupo cmac
    aibenchef ingest --periodo 202404
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import click

# psycopg async requiere SelectorEventLoop. Windows usa ProactorEventLoop por
# default, lo que rompe la conexion. Esto se setea ANTES de cualquier asyncio.run().
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from aibenchef_data.domains.catalog import (
    EntidadesCatalog,
    Grupo,
    Periodo,
    SbsUrlBuilder,
    Topico,
)
from aibenchef_data.domains.parsing import XlsInspector
from aibenchef_data.domains.scraping import (
    DiscoverTargets,
    DownloaderService,
    HttpxDownloader,
)
from aibenchef_data.domains.shared import configure_logging, get_logger
from aibenchef_data.env import settings
from aibenchef_data.infrastructure.http import sbs_http_client
from aibenchef_data.infrastructure.storage import RawStorage


@click.group()
@click.version_option()
def main() -> None:
    """Aibenchef data platform CLI."""
    configure_logging()


@main.group()
def db() -> None:
    """Comandos de diagnostico y operacion de la base de datos."""


def _resolve_migrations_dir() -> Path:
    """Resuelve el directorio de migraciones.

    Prioridad:
    1. env var MIGRATIONS_DIR (mismo nombre que usa el migrator de Node).
    2. <repo_root>/infrastructure/postgres/migrations descubierto desde __file__.
    """
    import os

    env_dir = os.environ.get("MIGRATIONS_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    cur = Path(__file__).resolve()
    for parent in cur.parents:
        candidate = parent / "infrastructure" / "postgres" / "migrations"
        if candidate.is_dir():
            return candidate
    msg = "No pude encontrar infrastructure/postgres/migrations. Pasa MIGRATIONS_DIR."
    raise click.ClickException(msg)


@db.command("migrate")
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Solo lista pendientes, no aplica nada.",
)
@click.option(
    "--migrations-dir",
    type=click.Path(exists=True, file_okay=False, path_type=str),
    default=None,
    help="Override del directorio de migraciones (sino se autodescubre).",
)
def db_migrate(dry_run: bool, migrations_dir: str | None) -> None:
    """Aplicar migraciones V*.sql pendientes contra DATABASE_URL.

    Espejo del migrator de Node (apps/web/scripts/migrate.ts):
    - mismo tracking en public.schema_migrations
    - mismo orden V<N>__<descripcion>.sql
    - una transaccion por archivo, idempotente
    - util cuando EasyPanel no rebuildea la imagen Docker y necesitas
      empujar DDL al Postgres remoto desde tu maquina.
    """
    import re

    import psycopg

    mig_dir = Path(migrations_dir).resolve() if migrations_dir else _resolve_migrations_dir()
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    pattern = re.compile(r"^V\d+__.*\.sql$")
    all_files = sorted(f for f in mig_dir.iterdir() if pattern.match(f.name))
    if not all_files:
        raise click.ClickException(f"No hay archivos V*.sql en {mig_dir}")

    click.echo(f"# Migraciones desde: {mig_dir}")
    click.echo(f"# Archivos encontrados: {len(all_files)}")

    try:
        with psycopg.connect(url, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.schema_migrations (
                        version    TEXT PRIMARY KEY,
                        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                conn.commit()
                cur.execute("SELECT version FROM public.schema_migrations")
                applied = {r[0] for r in cur.fetchall()}

            pending = [f for f in all_files if f.name.split("__")[0] not in applied]
            click.echo(f"# Aplicadas previas: {len(applied)}")
            click.echo(f"# Pendientes:        {len(pending)}\n")

            if not pending:
                click.echo("# Nada que hacer. Base al dia.")
                return

            for f in pending:
                version = f.name.split("__")[0]
                if dry_run:
                    click.echo(f"  [dry-run] {version}  ({f.name})")
                    continue
                ddl = f.read_text(encoding="utf-8")
                click.echo(f"  applying {version}  ({f.name})")
                try:
                    with conn.cursor() as cur:
                        cur.execute(ddl)
                        cur.execute(
                            "INSERT INTO public.schema_migrations (version) VALUES (%s)",
                            (version,),
                        )
                    conn.commit()
                    click.echo(f"  OK {version}")
                except Exception as e:
                    conn.rollback()
                    click.echo(f"  FATAL {version}: {type(e).__name__}: {e}")
                    raise click.Abort() from e

            click.echo("\n# Done.")
    except psycopg.OperationalError as e:
        click.echo(f"# ERROR de conexion: {e}")
        raise click.Abort() from e


@db.command("ping")
def db_ping() -> None:
    """Probar la conexion al Postgres configurado en DATABASE_URL.

    Usa el cliente psycopg sincrono (sin event loop) para diagnosticar.
    Muestra el host/puerto/db/user que va a usar antes de conectar.
    """
    from urllib.parse import urlparse

    import psycopg

    url = settings().database_url
    # Mascarar password en el output.
    parsed = urlparse(url)
    safe_url = url.replace(parsed.password or "", "***") if parsed.password else url

    click.echo("# Conectando a:")
    click.echo(f"  url:    {safe_url}")
    click.echo(f"  host:   {parsed.hostname}")
    click.echo(f"  port:   {parsed.port}")
    click.echo(f"  db:     {parsed.path.lstrip('/')}")
    click.echo(f"  user:   {parsed.username}")
    click.echo("")

    try:
        # psycopg quiere postgres:// o postgresql://, NO postgresql+asyncpg://
        clean = url.replace("postgresql+asyncpg://", "postgresql://")
        with psycopg.connect(clean, connect_timeout=10) as conn, conn.cursor() as cur:
            cur.execute("SELECT current_database(), version()")
            row = cur.fetchone()
            click.echo("# Conexion OK")
            click.echo(f"  database: {row[0]}")
            click.echo(f"  version:  {row[1]}")
            cur.execute("SELECT version FROM public.schema_migrations ORDER BY version")
            versions = [r[0] for r in cur.fetchall()]
            click.echo(f"  migrations applied ({len(versions)}): {versions}")
    except psycopg.OperationalError as e:
        click.echo(f"# ERROR de conexion: {e}")
        click.echo("\n# Diagnostico rapido:")
        click.echo(f"  Test-NetConnection -ComputerName {parsed.hostname} -Port {parsed.port}")
        click.echo("  Si TcpTestSucceeded:False -> puerto cerrado o firewall.")
        click.echo("  Opciones: exponer puerto en EasyPanel o usar SSH tunnel.")
        raise click.Abort() from e
    except Exception as e:
        click.echo(f"# ERROR: {type(e).__name__}: {e}")
        raise click.Abort() from e


# ============================================================================
# catalog
# ============================================================================


@main.group()
def catalog() -> None:
    """Comandos del catalogo (entidades, topicos, periodos)."""


@catalog.command("list-entidades")
@click.option("--grupo", type=click.Choice([g.value for g in Grupo]), default=None)
@click.option("--solo-microfinanzas", is_flag=True, default=False)
@click.option("--solo-activas", is_flag=True, default=True)
def catalog_list_entidades(grupo: str | None, solo_microfinanzas: bool, solo_activas: bool) -> None:
    """Listar entidades del catalogo SBS."""
    cat = EntidadesCatalog.default()
    g = Grupo(grupo) if grupo else None
    entidades = cat.list(grupo=g, solo_activas=solo_activas)
    if solo_microfinanzas:
        entidades = [e for e in entidades if e.es_microfinanciera]
    if not entidades:
        click.echo("(sin entidades)")
        return
    click.echo(f"{'CODIGO':<8} {'GRUPO':<18} NOMBRE")
    click.echo("-" * 80)
    for e in entidades:
        flag = "*" if e.es_microfinanciera else " "
        click.echo(f"{e.codigo_sbs:<8} {e.grupo.value:<18} {flag} {e.nombre_corto or e.nombre}")
    click.echo(f"\nTotal: {len(entidades)} entidades")


@catalog.command("show-topicos")
def catalog_show_topicos() -> None:
    """Listar topicos disponibles."""
    click.echo(f"{'SEQ':<5} {'CODE':<25} LABEL")
    click.echo("-" * 80)
    for t in Topico:
        click.echo(f"{t.folder_seq:<5} {t.value:<25} {t.label}")


@catalog.command("periodo")
@click.argument("periodo", type=str, required=False)
def catalog_periodo(periodo: str | None) -> None:
    """Inspeccionar un periodo. Vacio = mes anterior."""
    p = Periodo.from_yyyymm(periodo) if periodo else Periodo.previous_month()
    click.echo(f"Periodo:      {p}")
    click.echo(f"ISO:          {p.iso}")
    click.echo(f"Nombre mes:   {p.nombre_mes} {p.anio}")
    click.echo(f"SBS suffix:   {p.sbs_suffix}")
    click.echo(f"Cierre:       {p.cierre}")
    click.echo(f"Anterior:     {p.previous()}")
    click.echo(f"Siguiente:    {p.next()}")


@catalog.command("extract-canonical")
@click.option(
    "--base-eeff",
    type=click.Path(exists=True, dir_okay=False, path_type=str),
    required=True,
    help="Ruta al archivo BASE EE.FF..xlsx de Gus (fila 0 hoja BG y ER tienen los codigos canonicos).",
)
@click.option(
    "--out-dir",
    type=click.Path(file_okay=False, path_type=str),
    default="./seeds",
    help="Donde escribir los seeds JSON (cuentas_balance.json, etc).",
)
@click.option(
    "--bg-sheet",
    type=str,
    default="BG",
    help="Nombre de la hoja Balance General (default: BG).",
)
@click.option(
    "--er-sheet",
    type=str,
    default="ER",
    help="Nombre de la hoja Estado de Resultados (default: ER).",
)
def catalog_extract_canonical(base_eeff: str, out_dir: str, bg_sheet: str, er_sheet: str) -> None:
    """Extraer plan de cuentas canonico con codigos reales SBS (A1.1, B2, etc).

    Lee la fila 0 de las hojas BG y ER de BASE EE.FF..xlsx. Cada columna ahi
    tiene formato '(A1.1) Caja' = codigo regulatorio real + nombre.
    """
    from pathlib import Path as _P

    from aibenchef_data.domains.catalog.repositories.cuentas_canonicas_extractor import (
        extract_from_base_eeff,
        write_seeds,
    )

    src = _P(base_eeff)
    dest = _P(out_dir)

    click.echo(f"# Extrayendo plan canonico desde {src.name}")
    seeds = extract_from_base_eeff(src, bg_sheet_name=bg_sheet, er_sheet_name=er_sheet)

    for categoria, items in seeds.items():
        by_nivel: dict[int, int] = {}
        for c in items:
            by_nivel[c.nivel] = by_nivel.get(c.nivel, 0) + 1
        niveles_str = " ".join(f"L{lvl}={n}" for lvl, n in sorted(by_nivel.items()))
        click.echo(f"  {categoria:<13} {len(items):>4} cuentas  ({niveles_str})")

    paths = write_seeds(seeds, out_dir=dest)
    click.echo("\n# Escritos:")
    for cat, p in paths.items():
        click.echo(f"  {cat:<13} -> {p}")


@catalog.command("seed-dim-cuenta")
@click.option(
    "--seeds-dir",
    type=click.Path(exists=True, file_okay=False, path_type=str),
    default="./seeds",
    help="Carpeta con cuentas_balance.json y cuentas_resultados.json.",
)
def catalog_seed_dim_cuenta(seeds_dir: str) -> None:
    """Pobla dw.dim_cuenta desde los seeds JSON (idempotente, UPSERT)."""
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import DimCuentaSeeder
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    async def _run() -> None:
        await open_pool()
        try:
            async with connection() as conn:
                seeder = DimCuentaSeeder(conn)
                n = await seeder.seed_from_json(_P(seeds_dir))
                await conn.commit()
                click.echo(f"# dw.dim_cuenta: {n} filas upserted desde {seeds_dir}")
        finally:
            await close_pool()

    asyncio.run(_run())


@catalog.command("urls")
@click.argument("periodo", type=str)
@click.option("--grupo", type=click.Choice([g.value for g in Grupo]), default=None)
@click.option("--topico", type=click.Choice([t.value for t in Topico]), default=None)
def catalog_urls(periodo: str, grupo: str | None, topico: str | None) -> None:
    """Mostrar todas las URLs SBS que se descargarian para un periodo."""
    p = Periodo.from_yyyymm(periodo)
    grupos = [Grupo(grupo)] if grupo else None
    topicos = [Topico(topico)] if topico else None
    refs = SbsUrlBuilder.all_for_periodo(p, grupos=grupos, topicos=topicos)
    base = settings().sbs_base_url
    click.echo(f"# {len(refs)} archivos para {p}\n")
    for r in refs:
        click.echo(f"{r.grupo.value:<18} {r.topico.value:<25} {r.url(base)}")


# ============================================================================
# scrape — descarga .xls desde SBS al storage local
# ============================================================================


@main.command()
@click.option("--periodo", type=str, default=None, help="YYYYMM. Vacio = mes anterior.")
@click.option(
    "--grupo",
    type=click.Choice([g.value for g in Grupo]),
    default=None,
    help="Filtrar por grupo. Vacio = todos.",
)
@click.option(
    "--topico",
    type=click.Choice([t.value for t in Topico]),
    default=None,
    help="Filtrar por topico. Vacio = todos.",
)
@click.option("--dry-run", is_flag=True, default=False, help="Listar sin descargar.")
@click.option("--force", is_flag=True, default=False, help="Re-bajar aun si ya existe.")
def scrape(
    periodo: str | None,
    grupo: str | None,
    topico: str | None,
    dry_run: bool,
    force: bool,
) -> None:
    """Descargar .xls del SBS al storage local."""
    p = Periodo.from_yyyymm(periodo) if periodo else Periodo.previous_month()
    grupos = [Grupo(grupo)] if grupo else None
    topicos = [Topico(topico)] if topico else None

    log = get_logger(__name__)
    log.info(
        "scrape.plan",
        periodo=str(p),
        grupo=grupo or "all",
        topico=topico or "all",
        dry_run=dry_run,
        force=force,
    )
    asyncio.run(_run_scrape(p, grupos, topicos, dry_run=dry_run, force=force))


async def _run_scrape(
    periodo: Periodo,
    grupos: list[Grupo] | None,
    topicos: list[Topico] | None,
    *,
    dry_run: bool,
    force: bool,
) -> None:
    get_logger(__name__)
    cfg = settings()
    storage = RawStorage()
    discoverer = DiscoverTargets(storage=storage, base_url=cfg.sbs_base_url)
    targets = discoverer.for_periodo(periodo, grupos=grupos, topicos=topicos)

    click.echo(f"# {len(targets)} archivos a procesar para {periodo}")
    if dry_run:
        for t in targets:
            click.echo(f"  - {t.url}")
            click.echo(f"      -> {t.dest}")
        return

    async with sbs_http_client() as client:
        downloader = HttpxDownloader(
            client,
            max_retries=cfg.sbs_max_retries,
            skip_if_exists=not force,
        )
        service = DownloaderService(downloader, concurrency=cfg.sbs_download_concurrency)
        results = await service.download_all(targets)

    succeeded = DownloaderService.succeeded(results)
    failed = DownloaderService.failed(results)
    click.echo(f"\nResumen: {len(succeeded)} OK, {len(failed)} fallidos.")
    for r in failed:
        click.echo(f"  FALLO {r.target.url}: {r.error_message}")


# ============================================================================
# ingest — pipeline completo (stub aun)
# ============================================================================


@main.command()
@click.option("--periodo", type=str, default=None)
@click.option("--grupo", type=click.Choice([g.value for g in Grupo]), default=None)
@click.option("--topico", type=click.Choice([t.value for t in Topico]), default=None)
def ingest(periodo: str | None, grupo: str | None, topico: str | None) -> None:
    """Pipeline completo: scrape -> parse -> load -> dbt. (parse/load en construccion)"""
    log = get_logger(__name__)
    log.warning(
        "ingest.partial", message="Por ahora solo corre scrape. Parser y loader en Fase 1.4/1.5."
    )
    ctx = click.get_current_context()
    ctx.invoke(scrape, periodo=periodo, grupo=grupo, topico=topico, dry_run=False, force=False)


# ============================================================================
# import — carga de archivos al raw.* schema en Postgres
# ============================================================================


@main.group("import")
def import_grp() -> None:
    """Comandos de carga de datos a raw.* en Postgres."""


@import_grp.command("base-eeff")
@click.argument(
    "path",
    type=click.Path(exists=True, dir_okay=False, path_type=str),
)
@click.option("--bg-sheet", type=str, default="BG")
@click.option("--er-sheet", type=str, default="ER")
@click.option("--batch-size", type=int, default=10_000)
def import_base_eeff(path: str, bg_sheet: str, er_sheet: str, batch_size: int) -> None:
    """Bootstrap historico: cargar BASE EE.FF..xlsx a raw.eeff_observacion."""
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import BaseEeffImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    async def _run() -> None:
        await open_pool()
        try:
            async with connection() as conn:
                importer = BaseEeffImporter(conn, batch_size=batch_size)
                result = await importer.import_file(_P(path), bg_sheet=bg_sheet, er_sheet=er_sheet)
                await conn.commit()
                click.echo(
                    f"# Import {result.source_file}:\n"
                    f"  rows_inserted: {result.rows_inserted:,}\n"
                    f"  duration:      {result.duration_seconds:.1f}s\n"
                    f"  errors:        {len(result.errors)}"
                )
                for err in result.errors:
                    click.echo(f"  ERROR: {err}")
        finally:
            await close_pool()

    asyncio.run(_run())


# ============================================================================
# inspect — herramienta para entender la estructura de un .xls SBS
# ============================================================================


@main.group()
def inspect() -> None:
    """Herramientas para inspeccionar archivos descargados."""


@inspect.command("xls")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--rows", type=int, default=20, help="Numero de filas a previsualizar.")
@click.option("--cols", type=int, default=12, help="Numero de columnas a previsualizar.")
def inspect_xls(path: str, rows: int, cols: int) -> None:
    """Mostrar la estructura interna de un .xls SBS (hojas, dims, primeras filas)."""
    from pathlib import Path as _P

    inspector = XlsInspector(max_preview_rows=rows, max_preview_cols=cols)
    click.echo(inspector.inspect(_P(path)))


@inspect.command("xls-all")
@click.argument(
    "directory",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=str),
)
@click.option("--rows", type=int, default=10)
@click.option("--cols", type=int, default=8)
def inspect_xls_all(directory: str, rows: int, cols: int) -> None:
    """Mostrar estructura de todos los .xls bajo un directorio (recursivo)."""
    from pathlib import Path as _P

    base = _P(directory)
    files = sorted(base.rglob("*.xls"))
    if not files:
        click.echo(f"(sin .xls en {base})")
        return
    inspector = XlsInspector(max_preview_rows=rows, max_preview_cols=cols)
    for f in files:
        click.echo(inspector.inspect(f))
        click.echo("\n" + "=" * 100 + "\n")


if __name__ == "__main__":
    main()
