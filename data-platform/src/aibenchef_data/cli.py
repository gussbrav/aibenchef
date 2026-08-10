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


@main.group("storage")
def storage_grp() -> None:
    """Comandos de gestion del storage local (archivos .xls descargados)."""


@storage_grp.command("scan")
@click.option(
    "--root",
    type=click.Path(exists=True, file_okay=False, path_type=str),
    default="./local-data/raw",
    help="Directorio raiz que contiene <grupo>/<topico>/<anio>/<mes>/<archivo>.xls",
)
@click.option("--dry-run", is_flag=True, default=False)
def storage_scan(root: str, dry_run: bool) -> None:
    """Escanea el storage local y registra archivos en raw.archivos_descargados.

    Idempotente: si un path ya esta registrado, actualiza tamanio/hash; si es
    nuevo, inserta con status='descargado'.
    """
    import hashlib
    import re

    import psycopg

    from aibenchef_data.domains.parsing.value_objects.xls_format import detect_xls_format

    root_path = Path(root).resolve()
    files = sorted(root_path.rglob("*.xls"))
    click.echo(f"# Scaneando {root_path}")
    click.echo(f"# Archivos encontrados: {len(files)}")

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    pattern_path = re.compile(
        r"(?P<grupo>[^/\\]+)[/\\](?P<topico>[^/\\]+)[/\\](?P<anio>\d{4})[/\\](?P<mes>\d{2})[/\\](?P<archivo>.+\.xls)$",
        re.IGNORECASE,
    )
    # Para reconstruir el URL SBS necesitamos conocer el mapeo mes->NombreMes
    meses_es = {
        "01": "Enero",
        "02": "Febrero",
        "03": "Marzo",
        "04": "Abril",
        "05": "Mayo",
        "06": "Junio",
        "07": "Julio",
        "08": "Agosto",
        "09": "Septiembre",
        "10": "Octubre",
        "11": "Noviembre",
        "12": "Diciembre",
    }
    sbs_base = "https://intranet2.sbs.gob.pe/estadistica/financiera"

    # ---- Performance: pre-cargar paths existentes y hacer INSERT en bulk ----
    # Antes: 1 INSERT/UPDATE por archivo (~5,000 round-trips a Hetzner = 5+ min).
    # Ahora: 1 SELECT inicial + 2 executemany (insert + update) = ~10 segundos.
    # Tambien skipea MD5 si --no-hash (el archivo ya esta validado por SBS).

    inserted_rows: list[tuple] = []
    updated_rows: list[tuple] = []
    skipped = 0

    with psycopg.connect(url, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT path_local FROM raw.archivos_descargados")
            existing_paths = {row[0] for row in cur.fetchall()}

        for f in files:
            rel = str(f.relative_to(root_path)).replace("\\", "/")
            m = pattern_path.search(rel)
            if not m:
                skipped += 1
                continue
            grupo = m.group("grupo")
            topico = m.group("topico")
            anio = int(m.group("anio"))
            mes = int(m.group("mes"))
            archivo = m.group("archivo")
            periodo = anio * 100 + mes
            path_str = str(f)

            size = f.stat().st_size
            # MD5 solo para archivos nuevos (los existentes ya tienen su hash);
            # esto evita re-leer todo el filesystem en cada scan.
            try:
                fmt = detect_xls_format(f)
            except Exception:
                fmt = None
            url_sbs = f"{sbs_base}/{anio}/{meses_es[m.group('mes')]}/{archivo}"

            if dry_run:
                click.echo(f"  [dry] {rel}  size={size:,}B  fmt={fmt}")
                continue

            if path_str in existing_paths:
                # Update ligero (sin re-MD5)
                updated_rows.append((size, fmt, path_str))
            else:
                # MD5 solo para los nuevos
                with open(f, "rb") as fh:
                    md5 = hashlib.md5(fh.read()).hexdigest()
                inserted_rows.append(
                    (
                        grupo,
                        topico,
                        periodo,
                        anio,
                        mes,
                        archivo,
                        path_str,
                        url_sbs,
                        size,
                        md5,
                        fmt,
                    )
                )

        # Bulk inserts en batches con commit intermedio. Sin esto, el server
        # cierra la conexion despues de unos minutos con executemany grande
        # ("consuming input failed: server closed the connection unexpectedly").
        BATCH = 500

        def _chunked(rows, n):
            for i in range(0, len(rows), n):
                yield rows[i : i + n]

        if inserted_rows:
            insert_sql = """
                INSERT INTO raw.archivos_descargados (
                    grupo, topico, periodo, anio, mes,
                    nombre_archivo, path_local, source_url,
                    tamanio_bytes, md5_hash, formato
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (path_local) DO NOTHING
            """
            for batch in _chunked(inserted_rows, BATCH):
                with conn.cursor() as cur:
                    cur.executemany(insert_sql, batch)
                conn.commit()

        if updated_rows:
            # Fix bug #126: si un archivo estaba marcado `no_publicado_sbs` (tamanio=0)
            # y ahora tiene contenido valido en disco (>=2KB), debe pasar a
            # `descargado` para que los imports lo procesen. Sin esto, el dashboard
            # muestra `no_publicado_sbs` aunque el archivo este fisicamente
            # presente — exactamente el caso real de abril 2026.
            # Estados terminales (`procesado`, `error`, `omitido`) NO se tocan.
            update_sql = """
                UPDATE raw.archivos_descargados
                SET tamanio_bytes = %s,
                    formato = %s,
                    actualizado_en = now(),
                    status = CASE
                        WHEN status = 'no_publicado_sbs' AND %s >= 2000 THEN 'descargado'
                        ELSE status
                    END,
                    error_mensaje = CASE
                        WHEN status = 'no_publicado_sbs' AND %s >= 2000 THEN NULL
                        ELSE error_mensaje
                    END
                WHERE path_local = %s
            """
            # Re-armar tuplas con el size duplicado para los CASE WHEN.
            update_rows_expanded = [
                (size, fmt, size, size, path_str) for (size, fmt, path_str) in updated_rows
            ]
            for batch in _chunked(update_rows_expanded, BATCH):
                with conn.cursor() as cur:
                    cur.executemany(update_sql, batch)
                conn.commit()

    click.echo("")
    click.echo(f"# Insertados: {len(inserted_rows)}")
    click.echo(f"# Actualizados: {len(updated_rows)}")
    click.echo(f"# Skipped (path no parseable): {skipped}")


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


@db.command("refresh-mvs")
@click.option(
    "--concurrently",
    is_flag=True,
    default=False,
    help="REFRESH CONCURRENTLY (no bloquea lecturas pero requiere unique index).",
)
def db_refresh_mvs(concurrently: bool) -> None:
    """Refresca las vistas materializadas EEFF tras una carga nueva.

    Refresca en orden:
      1. marts.mv_eeff_balance_ancho
      2. marts.mv_eeff_resultados_ancho
      3. marts.mv_eeff_ratios   (depende de las dos anteriores)

    Usar --concurrently en produccion para no bloquear el dashboard mientras
    se refresca (requiere que la MV tenga unique index, lo cual ya esta).
    """
    import time

    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    mvs = [
        # EEFF (base)
        "marts.mv_eeff_balance_ancho",
        "marts.mv_eeff_resultados_ancho",
        "marts.mv_eeff_ratios",
        # Negocio
        "marts.mv_colocaciones_resumen",
        "marts.mv_colocaciones_por_tipo",
        "marts.mv_depositos_resumen",
        "marts.mv_castigos_resumen",
        # Indicadores prudenciales
        "marts.mv_indicadores_prudenciales",
        # Personal
        "marts.mv_personal_resumen",
        # Clientes
        "marts.mv_clientes_resumen",
        # Tasas
        "marts.mv_tasas_activas_resumen",
        "marts.mv_tasas_pasivas_resumen",
        # Geografia
        "marts.mv_creditos_distrito_long",
        "marts.mv_cobertura_geografica",
    ]
    keyword = (
        "REFRESH MATERIALIZED VIEW CONCURRENTLY" if concurrently else "REFRESH MATERIALIZED VIEW"
    )

    with psycopg.connect(url, connect_timeout=10) as conn:
        for mv in mvs:
            click.echo(f"# {keyword} {mv} ...")
            start = time.perf_counter()
            with conn.cursor() as cur:
                cur.execute(f"{keyword} {mv}")
            conn.commit()
            elapsed = time.perf_counter() - start

            # Reportar conteo final
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) FROM {mv}")
                count = cur.fetchone()[0]
            click.echo(f"  -> OK en {elapsed:.1f}s ({count:,} filas)")

    click.echo("")
    click.echo("# Refresh completo. Dashboard ya ve la data nueva.")


@db.command("status")
def db_status() -> None:
    """Resumen del estado de cada dominio SBS cargado en la DB."""

    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    dominios = [
        ("raw.eeff_observacion", "EEFF (BG + ER)"),
        ("raw.colocaciones_observacion", "Colocaciones"),
        ("raw.depositos_observacion", "Depositos"),
        ("raw.castigos_observacion", "Castigos"),
        ("raw.patrimonio_efectivo", "Patrimonio Efectivo"),
        ("raw.ratio_liquidez", "Ratio Liquidez"),
        ("raw.ratio_capital_global", "RCG (Basilea III)"),
        ("raw.personal_observacion", "Personal (Headcount)"),
        ("raw.clientes_ahorros", "Clientes Ahorros"),
        ("raw.clientes_creditos", "Clientes Creditos"),
        ("raw.tasas_activas", "Tasas Activas"),
        ("raw.tasas_pasivas", "Tasas Pasivas"),
        ("raw.creditos_distrito", "Creditos por Distrito"),
        ("raw.creditos_depositos_oficina", "Cred+Dep por Oficina"),
    ]

    click.echo(f"{'Dominio':<28} {'Filas':>14} {'Periodos':<20}")
    click.echo("-" * 70)
    total = 0
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        for tabla, label in dominios:
            try:
                cur.execute(f"SELECT COUNT(*), MIN(periodo), MAX(periodo) FROM {tabla}")
                n, mn, mx = cur.fetchone() or (0, None, None)
                total += n or 0
                rng = f"{mn} - {mx}" if mn else "(vacio)"
                click.echo(f"  {label:<26} {n:>14,}  {rng}")
            except Exception as e:
                click.echo(f"  {label:<26}  ERR: {e}")
    click.echo("-" * 70)
    click.echo(f"  {'TOTAL':<26} {total:>14,}")


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


@catalog.command("init-maestra")
@click.option(
    "--periodo",
    type=str,
    required=True,
    help="YYYYMM del periodo desde el cual extraer la cabecera (ej 202603).",
)
@click.option("--dry-run", is_flag=True, default=False)
def catalog_init_maestra(periodo: str, dry_run: bool) -> None:
    """Inicializa dw.cabecera_maestra extrayendo el orden estructural desde
    los archivos SBS reales del periodo indicado.

    Para cada grupo (BANCOS, FINANCIERAS, CMAC, CRAC, EDPYMES) busca un
    archivo EEFF del periodo y registra la cabecera en orden, mapeando cada
    fila al codigo canonico de dw.dim_cuenta via matching por nombre +
    fuzzy. El resultado es la base estructural posicional que reemplaza el
    matching por nombre del importer.
    """
    import re
    from pathlib import Path as _P

    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        _cell_str,
        _CuentaLookup,
        _detect_layout,
        _normalize,
    )
    from aibenchef_data.domains.parsing import read_xls

    p = Periodo.from_yyyymm(periodo)
    sql_pat = {
        "BANCOS": "banca_multiple",
        "FINANCIERAS": "financiera",
        "CMAC": "cmac",
        "CRAC": "crac",
        "EDPYMES": "edpyme",
    }

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    storage_root = _P("./local-data/raw").resolve()

    import asyncio as _asyncio

    import psycopg as _ps

    async def _build_lookups() -> tuple[_CuentaLookup, _CuentaLookup]:
        # Helper que crea ambos lookups en una sola apertura del pool
        from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

        await open_pool()
        try:
            async with connection() as conn:
                bal = await _CuentaLookup.from_db(conn, tipo_estado="balance")
                res = await _CuentaLookup.from_db(conn, tipo_estado="resultados")
                return bal, res
        finally:
            await close_pool()

    lookup_balance, lookup_resultados = _asyncio.run(_build_lookups())

    total_rows = 0
    insertados_por_grupo: dict[str, int] = {}

    with _ps.connect(url, connect_timeout=10) as conn:
        for grupo, dir_grupo in sql_pat.items():
            base = storage_root / dir_grupo / "eeff" / str(p.anio) / f"{p.mes:02d}"
            if not base.is_dir():
                click.echo(f"  [SKIP] {grupo}: no hay carpeta {base}")
                continue
            files = sorted(base.glob("*.xls"))
            if not files:
                click.echo(f"  [SKIP] {grupo}: sin archivos")
                continue
            f = files[0]
            click.echo(f"  [{grupo:<12}] {f.name}")
            sheets = read_xls(f)
            balance_sheet = next((s for s in sheets if _is_balance_sheet(s)), None)
            resultados_sheet = next((s for s in sheets if _is_resultados_sheet(s)), None)

            for tipo_estado, sheet, lookup in (
                ("balance", balance_sheet, lookup_balance),
                ("resultados", resultados_sheet, lookup_resultados),
            ):
                if sheet is None:
                    continue
                layout = _detect_layout(sheet)
                orden = 0
                section = "A" if tipo_estado == "balance" else ""
                parent: str | None = section if section == "C" else None
                # Pre-cargar markers
                section_markers = {
                    "activo": "A",
                    "pasivo": "B",
                    "patrimonio": "C",
                    "patrimonio neto": "C",
                }
                # Totales: se conservan en cabecera con codigo NULL para preservar
                # alineacion posicional con los archivos. Importer las saltea.
                null_markers = {
                    "total activo",
                    "total pasivo",
                    "total pasivo y patrimonio",
                    "total patrimonio",
                    "total patrimonio neto",
                    "contingentes",
                    "cuentas contingentes",
                    "cuentas de orden",
                    # Footnotes y off-balance frecuentes en archivos SBS:
                    "avales, cartas fianza, cartas de credito y aceptaciones",
                    "lineas de credito no utilizadas y creditos concedidos no desembolsados",
                    "instrumentos financieros derivados",
                    "otras cuentas contingentes",
                }
                for r in range(layout.data_start_row, sheet.n_rows):
                    nombre_raw = _cell_str(sheet, r, 0)
                    if not nombre_raw:
                        continue
                    nombre_norm = _normalize(nombre_raw)

                    # Footnotes que empiezan con "tipo de cambio" o "N/" (notas al pie)
                    if nombre_norm.startswith("tipo de cambio") or re.match(
                        r"^\d+/\s", nombre_raw.strip()
                    ):
                        # Las dejamos en maestra como NULL codigo para mantener orden
                        is_null_row = True
                    elif nombre_norm in null_markers:
                        is_null_row = True
                    else:
                        is_null_row = False

                    # Section header (Activo/Pasivo/Patrimonio): actualiza section
                    # tracker pero no incrementa orden. Es solo metadata visual.
                    if (
                        tipo_estado == "balance"
                        and not is_null_row
                        and nombre_norm in section_markers
                    ):
                        section = section_markers[nombre_norm]
                        parent = section if section == "C" else None
                        continue

                    es_header = nombre_raw.strip() == nombre_raw.strip().upper()
                    codigo: str | None = None
                    if is_null_row:
                        codigo = None
                    elif es_header:
                        resolved = lookup.find_header(section, nombre_norm)
                        if resolved:
                            codigo, _ = resolved
                            parent = codigo
                    elif parent:
                        resolved = lookup.find_child(parent, nombre_norm)
                        if resolved:
                            codigo, _ = resolved

                    orden += 1
                    if dry_run:
                        codigo_str = "NULL" if codigo is None else f"codigo={codigo}"
                        click.echo(
                            f"    {tipo_estado:<11} orden={orden:>3} "
                            f"{codigo_str:<20} "
                            f"nombre={nombre_raw[:50]!r}"
                        )
                        continue
                    # Insertar a la maestra
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO dw.cabecera_maestra
                                (tipo_estado, tipo_entidad, orden, codigo, nombre,
                                 nivel, es_header, valido_desde)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (tipo_estado, tipo_entidad, orden, valido_desde)
                            DO UPDATE SET
                                codigo    = EXCLUDED.codigo,
                                nombre    = EXCLUDED.nombre,
                                es_header = EXCLUDED.es_header,
                                updated_at = now()
                            """,
                            (
                                tipo_estado,
                                grupo,
                                orden,
                                codigo,  # puede ser NULL
                                nombre_raw.strip(),
                                2 if es_header else 3,
                                es_header,
                                200801,
                            ),
                        )
                        insertados_por_grupo[grupo] = insertados_por_grupo.get(grupo, 0) + 1
                        total_rows += 1
        if not dry_run:
            conn.commit()

    click.echo("")
    if dry_run:
        click.echo("# Dry-run: no se inserto nada.")
    else:
        click.echo(f"# Total filas insertadas en cabecera_maestra: {total_rows}")
        for g, n in insertados_por_grupo.items():
            click.echo(f"  {g:<12} {n} filas")


@catalog.command("detectar-cambios")
@click.option(
    "--periodo",
    type=str,
    required=True,
    help="YYYYMM del periodo a validar contra la cabecera maestra.",
)
@click.option(
    "--grupo",
    type=click.Choice(["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"]),
    default=None,
    help="Validar solo un grupo. Vacio = todos.",
)
@click.option(
    "--max-diffs",
    type=int,
    default=10,
    help="Maximo de diferencias mostradas por (grupo, tipo_estado).",
)
def catalog_detectar_cambios(periodo: str, grupo: str | None, max_diffs: int) -> None:
    """Compara la estructura de un periodo contra dw.cabecera_maestra.

    Para cada (tipo_estado, tipo_entidad) descubre el archivo del periodo,
    extrae los nombres por orden y los compara con la maestra. Reporta:
      - Filas donde el nombre del archivo difiere del nombre maestro
      - Filas extras (archivo tiene mas filas que la maestra)
      - Filas faltantes (maestra tiene mas filas que el archivo)

    Util ANTES de re-importar para detectar si SBS cambio la estructura.
    Si hay diferencias significativas, considera versionar la maestra:
    valido_hasta = periodo_anterior y crear filas nuevas con valido_desde=periodo.
    """
    from pathlib import Path as _P

    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        _cell_str,
        _detect_layout,
        _normalize,
    )
    from aibenchef_data.domains.parsing import read_xls

    p = Periodo.from_yyyymm(periodo)
    sql_pat = {
        "BANCOS": "banca_multiple",
        "FINANCIERAS": "financiera",
        "CMAC": "cmac",
        "CRAC": "crac",
        "EDPYMES": "edpyme",
    }
    if grupo:
        sql_pat = {grupo: sql_pat[grupo]}

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    storage_root = _P("./local-data/raw").resolve()

    import psycopg as _ps

    total_diffs = 0
    with _ps.connect(url, connect_timeout=10) as conn:
        for tipo_entidad, dir_grupo in sql_pat.items():
            base = storage_root / dir_grupo / "eeff" / str(p.anio) / f"{p.mes:02d}"
            if not base.is_dir():
                click.echo(f"  [SKIP] {tipo_entidad}: carpeta no existe {base}")
                continue
            files = sorted(base.glob("*.xls"))
            if not files:
                click.echo(f"  [SKIP] {tipo_entidad}: sin archivos")
                continue
            f = files[0]
            sheets = read_xls(f)
            balance_sheet = next((s for s in sheets if _is_balance_sheet(s)), None)
            resultados_sheet = next((s for s in sheets if _is_resultados_sheet(s)), None)

            for tipo_estado, sheet in (
                ("balance", balance_sheet),
                ("resultados", resultados_sheet),
            ):
                if sheet is None:
                    continue
                # Extraer (orden, nombre_norm) desde el archivo
                layout = _detect_layout(sheet)
                file_rows: list[tuple[int, str, str]] = []  # (orden, nombre_norm, nombre_raw)
                orden = 0
                section_markers = {"activo", "pasivo", "patrimonio", "patrimonio neto"}
                for r in range(layout.data_start_row, sheet.n_rows):
                    nombre_raw = _cell_str(sheet, r, 0)
                    if not nombre_raw:
                        continue
                    nombre_norm = _normalize(nombre_raw)
                    if tipo_estado == "balance" and nombre_norm in section_markers:
                        continue  # mirror init-maestra behavior
                    orden += 1
                    file_rows.append((orden, nombre_norm, nombre_raw.strip()))

                # Cargar maestra
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT orden, nombre, codigo
                        FROM dw.cabecera_maestra
                        WHERE tipo_estado = %s
                          AND tipo_entidad = %s
                          AND valido_hasta IS NULL
                        ORDER BY orden
                        """,
                        (tipo_estado, tipo_entidad),
                    )
                    maestra_rows = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

                diffs_renamed: list[str] = []
                diffs_extra: list[str] = []
                diffs_missing: list[str] = []
                for orden, name_norm, name_raw in file_rows:
                    if orden not in maestra_rows:
                        diffs_extra.append(
                            f"orden={orden:>3}  archivo={name_raw[:60]!r}  (sin maestra)"
                        )
                        continue
                    maestra_nombre, _maestra_codigo = maestra_rows[orden]
                    if _normalize(maestra_nombre) != name_norm:
                        diffs_renamed.append(
                            f"orden={orden:>3}  "
                            f"maestra={maestra_nombre[:35]!r:<37}  "
                            f"archivo={name_raw[:35]!r}"
                        )
                file_ordenes = {o for o, _, _ in file_rows}
                for orden, (maestra_nombre, _codigo) in maestra_rows.items():
                    if orden not in file_ordenes:
                        diffs_missing.append(
                            f"orden={orden:>3}  maestra={maestra_nombre[:60]!r}  "
                            f"(archivo no tiene esta fila)"
                        )

                n_diffs = len(diffs_renamed) + len(diffs_extra) + len(diffs_missing)
                total_diffs += n_diffs
                status = "OK" if n_diffs == 0 else f"{n_diffs} diffs"
                click.echo(
                    f"  [{tipo_entidad:<12} {tipo_estado:<11}] {f.name:<25}  "
                    f"file={len(file_rows):>3}  maestra={len(maestra_rows):>3}  {status}"
                )
                for d in diffs_renamed[:max_diffs]:
                    click.echo(f"      ~ {d}")
                if len(diffs_renamed) > max_diffs:
                    click.echo(f"      ... ({len(diffs_renamed) - max_diffs} renames mas)")
                for d in diffs_extra[:max_diffs]:
                    click.echo(f"      + {d}")
                if len(diffs_extra) > max_diffs:
                    click.echo(f"      ... ({len(diffs_extra) - max_diffs} extras mas)")
                for d in diffs_missing[:max_diffs]:
                    click.echo(f"      - {d}")
                if len(diffs_missing) > max_diffs:
                    click.echo(f"      ... ({len(diffs_missing) - max_diffs} missing mas)")

    click.echo("")
    if total_diffs == 0:
        click.echo(f"# {periodo} alinea perfecto con la maestra. Safe to import.")
    else:
        click.echo(f"# {periodo} tiene {total_diffs} diferencias contra la maestra.")
        click.echo("# Si son cambios estructurales reales, versionar la maestra:")
        click.echo("#   UPDATE dw.cabecera_maestra SET valido_hasta=<periodo-anterior>")
        click.echo("#   y reinit con --periodo <nuevo>")


def _is_balance_sheet(sheet) -> bool:
    name = sheet.name.lower()
    if name.startswith("bg_"):
        return True
    for r in range(0, 4):
        v = sheet.cell(r, 0)
        if v and "balance general" in str(v).lower():
            return True
    return False


def _is_resultados_sheet(sheet) -> bool:
    name = sheet.name.lower()
    if name.startswith(("gyp_", "egyp_", "er_")):
        return True
    for r in range(0, 4):
        v = sheet.cell(r, 0)
        if not v:
            continue
        s = str(v).lower()
        if "estado de ganancias" in s or "estado de resultados" in s:
            return True
    return False


@catalog.command("normalize-entidades")
@click.option("--dry-run", is_flag=True, default=False)
def catalog_normalize_entidades(dry_run: bool) -> None:
    """Normaliza nombres de entidad en raw.eeff_observacion + dim_entidad.

    Aplica:
    - Quita asteriscos finales (***)
    - Quita superindices Unicode (¹²³⁴...)
    - Quita sufijos "N/" (notas al pie)
    - Aplica aliases definidos en dw.entidad_alias

    Cuando hay conflict (canonico ya existe), DELETE el duplicado y conserva
    los datos del canonico (los datos suelen ser identicos).
    """
    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        # 1) Listar todas las (entidad -> canonico) que serian renombradas
        cur.execute("""
            SELECT DISTINCT nomb_correg, dw.normalizar_entidad(nomb_correg) AS canonico
            FROM raw.eeff_observacion
            WHERE nomb_correg <> dw.normalizar_entidad(nomb_correg)
            ORDER BY 1
        """)
        renames = cur.fetchall()
        click.echo(f"# Renombres detectados: {len(renames)}")
        for nom, can in renames[:20]:
            click.echo(f"  {nom!r:<55} -> {can!r}")
        if len(renames) > 20:
            click.echo(f"  ... ({len(renames) - 20} mas)")

        if dry_run:
            click.echo("\n# Dry-run: no se aplico nada.")
            return

        # 2) Para cada par (viejo, canonico), si el canonico ya existe en una fila
        #    con misma key (periodo, moneda, tipo_estado, cuenta_codigo), borrar la
        #    fila vieja. Si NO existe, actualizar la fila vieja al canonico.
        deletes = 0
        updates = 0
        for viejo, canonico in renames:
            # Borrar duplicados (donde tanto el viejo como el canonico existen)
            cur.execute(
                """
                DELETE FROM raw.eeff_observacion v
                WHERE v.nomb_correg = %s
                  AND EXISTS (
                    SELECT 1 FROM raw.eeff_observacion c
                    WHERE c.nomb_correg = %s
                      AND c.periodo       = v.periodo
                      AND c.moneda        = v.moneda
                      AND c.tipo_estado   = v.tipo_estado
                      AND c.cuenta_codigo = v.cuenta_codigo
                  )
                """,
                (viejo, canonico),
            )
            deletes += cur.rowcount
            # Updatear las que quedan al canonico
            cur.execute(
                "UPDATE raw.eeff_observacion SET nomb_correg = %s WHERE nomb_correg = %s",
                (canonico, viejo),
            )
            updates += cur.rowcount
        conn.commit()

        # 3) Limpiar dim_entidad: borrar entidades duplicadas que ya no son referenciadas
        cur.execute(
            """
            DELETE FROM dw.dim_entidad e
            WHERE NOT EXISTS (
                SELECT 1 FROM raw.eeff_observacion r WHERE r.nomb_correg = e.nomb_correg
            )
            """
        )
        dropped_dim = cur.rowcount
        conn.commit()

        click.echo("")
        click.echo(f"# Aplicado: {updates} updates, {deletes} deletes en raw.eeff_observacion")
        click.echo(f"# dim_entidad limpiada: {dropped_dim} entidades obsoletas borradas")
        click.echo("# Siguiente paso: aibenchef db refresh-mvs --concurrently")


@catalog.command("add-alias")
@click.argument("alias_text")
@click.argument("canonico")
@click.option(
    "--fuente",
    default="manual",
    help="Origen del alias: manual / sbs_eeff / etc.",
)
def catalog_add_alias(alias_text: str, canonico: str, fuente: str) -> None:
    """Registra un alias en dw.entidad_alias.

    Ejemplo (renombre legal):
      aibenchef catalog add-alias "Banco Azteca" "Banco Alfin"

    Ejemplo (variante con asterisco):
      aibenchef catalog add-alias "Citibank***" "Citibank"
    """
    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM dw.dim_entidad WHERE nomb_correg = %s",
            (canonico,),
        )
        if not cur.fetchone():
            raise click.ClickException(
                f"El canonico {canonico!r} no existe en dw.dim_entidad. "
                "Primero crealo o usa el nombre exacto."
            )
        cur.execute(
            """
            INSERT INTO dw.entidad_alias (alias, nomb_correg, fuente)
            VALUES (%s, %s, %s)
            ON CONFLICT (alias) DO UPDATE SET
                nomb_correg = EXCLUDED.nomb_correg,
                fuente      = EXCLUDED.fuente
            """,
            (alias_text, canonico, fuente),
        )
        conn.commit()
        click.echo(f"# Alias registrado: {alias_text!r} -> {canonico!r}")


@catalog.command("extract-from-consolidado")
@click.option(
    "--balance",
    type=click.Path(exists=True, dir_okay=False, path_type=str),
    required=True,
    help="Ruta al CONSOLIDADO BALANCE SBS.xlsx",
)
@click.option(
    "--gyp",
    type=click.Path(exists=True, dir_okay=False, path_type=str),
    required=True,
    help="Ruta al CONSOLIDADO GYP SBS.xlsx (Estado de Resultados)",
)
@click.option(
    "--out-dir",
    type=click.Path(file_okay=False, path_type=str),
    default="./seeds",
    help="Donde escribir los seeds JSON.",
)
def catalog_extract_from_consolidado(balance: str, gyp: str, out_dir: str) -> None:
    """Extraer plan canonico MAESTRO desde CONSOLIDADO BALANCE/GYP SBS.

    Estos son los archivos que Gus mantiene desde 2020 con las 5 columnas
    paralelas (BANCOS / FINANCIERAS / CAJAS / CRACS / EDPYMES). El plan de
    BANCOS es el super-set; los grupos menores estan alineados por fila.

    Output: seeds/cuentas_balance.json y seeds/cuentas_resultados.json
    listos para cargar via 'aibenchef catalog seed-dim-cuenta'.
    """
    from pathlib import Path as _P

    from aibenchef_data.domains.catalog.repositories.consolidado_extractor import (
        extract_from_consolidado,
        write_seeds,
    )

    bal_path = _P(balance)
    gyp_path = _P(gyp)
    dest = _P(out_dir)

    click.echo("# Extrayendo plan canonico maestro:")
    click.echo(f"  balance: {bal_path}")
    click.echo(f"  gyp:     {gyp_path}")
    click.echo("")

    cuentas_by_tipo = extract_from_consolidado(balance_path=bal_path, gyp_path=gyp_path)

    for tipo, items in cuentas_by_tipo.items():
        by_nivel: dict[int, int] = {}
        by_grupo_count: dict[str, int] = {}
        for c in items:
            by_nivel[c.nivel] = by_nivel.get(c.nivel, 0) + 1
            for g in c.aplica_a:
                by_grupo_count[g] = by_grupo_count.get(g, 0) + 1
        niveles_str = " ".join(f"L{lvl}={n}" for lvl, n in sorted(by_nivel.items()))
        grupos_str = " ".join(f"{g}={n}" for g, n in sorted(by_grupo_count.items()))
        click.echo(f"  {tipo:<13} {len(items):>4} cuentas  niveles: {niveles_str}")
        click.echo(f"  {' ':<13}        aplica_a: {grupos_str}")

    paths = write_seeds(cuentas_by_tipo, out_dir=dest)
    click.echo("")
    click.echo("# Escritos:")
    for tipo, p in paths.items():
        click.echo(f"  {tipo:<13} -> {p}")
    click.echo("")
    click.echo("# Siguiente paso:")
    click.echo("  aibenchef catalog seed-dim-cuenta --seeds-dir " + str(dest))


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
@click.option(
    "--periodo",
    type=str,
    default=None,
    help="YYYYMM. Vacio = mes anterior. Ignorado si pasas --desde/--hasta.",
)
@click.option(
    "--desde", type=str, default=None, help="YYYYMM inicio de rango (inclusive). Requiere --hasta."
)
@click.option(
    "--hasta", type=str, default=None, help="YYYYMM fin de rango (inclusive). Requiere --desde."
)
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
    desde: str | None,
    hasta: str | None,
    grupo: str | None,
    topico: str | None,
    dry_run: bool,
    force: bool,
) -> None:
    """Descargar .xls del SBS al storage local.

    Modos:
      - 1 mes: --periodo 202404 (o vacio = mes anterior)
      - Rango: --desde 202304 --hasta 202604 (itera mes a mes)
    """
    if (desde and not hasta) or (hasta and not desde):
        raise click.UsageError("--desde y --hasta deben pasarse juntos.")

    if desde and hasta:
        periodos = _periodo_range(desde, hasta)
        click.echo(f"# Rango: {desde} -> {hasta} ({len(periodos)} meses)")
    else:
        p = Periodo.from_yyyymm(periodo) if periodo else Periodo.previous_month()
        periodos = [p]

    grupos = [Grupo(grupo)] if grupo else None
    topicos = [Topico(topico)] if topico else None

    log = get_logger(__name__)
    total_ok = 0
    total_fail = 0
    for i, p in enumerate(periodos, start=1):
        log.info(
            "scrape.plan",
            periodo=str(p),
            grupo=grupo or "all",
            topico=topico or "all",
            dry_run=dry_run,
            force=force,
            progreso=f"{i}/{len(periodos)}",
        )
        ok, fail = asyncio.run(_run_scrape(p, grupos, topicos, dry_run=dry_run, force=force))
        total_ok += ok
        total_fail += fail

    if len(periodos) > 1:
        click.echo("")
        click.echo(
            f"# TOTAL del rango: {total_ok} OK, {total_fail} fallidos sobre {len(periodos)} meses."
        )


def _periodo_range(desde: str, hasta: str) -> list[Periodo]:
    """Genera lista de Periodos entre desde y hasta (inclusive)."""
    start = Periodo.from_yyyymm(desde)
    end = Periodo.from_yyyymm(hasta)
    if end < start:
        raise click.UsageError(f"--hasta ({hasta}) debe ser >= --desde ({desde})")
    out: list[Periodo] = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur = cur.next()
    return out


async def _run_scrape(
    periodo: Periodo,
    grupos: list[Grupo] | None,
    topicos: list[Topico] | None,
    *,
    dry_run: bool,
    force: bool,
) -> tuple[int, int]:
    """Descarga los archivos del periodo. Devuelve (ok_count, fail_count)."""
    get_logger(__name__)
    cfg = settings()
    storage = RawStorage()
    discoverer = DiscoverTargets(storage=storage, base_url=cfg.sbs_base_url)
    targets = discoverer.for_periodo(periodo, grupos=grupos, topicos=topicos)

    click.echo(f"# {periodo}: {len(targets)} archivos a procesar")
    if dry_run:
        for t in targets:
            click.echo(f"  - {t.url}")
            click.echo(f"      -> {t.dest}")
        return 0, 0

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
    not_published = [r for r in results if r.status.value == "not_published"]
    click.echo(
        f"  -> {len(succeeded)} OK, {len(failed)} fallidos, {len(not_published)} no publicados."
    )
    for r in failed:
        click.echo(f"     FALLO {r.target.url}: {r.error_message}")

    # Registrar los archivos no publicados por SBS en archivos_descargados
    # con status='no_publicado_sbs'. Esto desambigua el gap silencioso en el
    # dashboard (issue #3) — el usuario ve que SBS no publico vs descarga fallo.
    if not_published:
        _registrar_no_publicados(not_published)

    return len(succeeded), len(failed)


def _registrar_no_publicados(results: list) -> None:
    """Inserta en raw.archivos_descargados los archivos que SBS no publico.

    Idempotente: ON CONFLICT (path_local) DO UPDATE solo si status sigue siendo
    'no_publicado_sbs' (no pisa archivos que despues fueron descargados manualmente).
    """
    import psycopg

    from aibenchef_data.env import settings as _settings

    url = _settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    insert_sql = """
        INSERT INTO raw.archivos_descargados (
            grupo, topico, periodo, anio, mes, nombre_archivo, path_local,
            source_url, tamanio_bytes, formato, status, error_mensaje,
            descargado_en, actualizado_en
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, 0, 'no_publicado', 'no_publicado_sbs', %s,
            NOW(), NOW()
        )
        ON CONFLICT (path_local) DO UPDATE
        SET status = 'no_publicado_sbs',
            error_mensaje = EXCLUDED.error_mensaje,
            actualizado_en = NOW()
        WHERE raw.archivos_descargados.status NOT IN ('procesado', 'descargado')
    """
    rows = []
    for r in results:
        t = r.target
        ref = t.ref
        rows.append(
            (
                ref.grupo.value,
                ref.topico.value,
                ref.periodo.anio * 100 + ref.periodo.mes,
                ref.periodo.anio,
                ref.periodo.mes,
                t.dest.name,
                str(t.dest),
                t.url,
                r.error_message or "SBS no publico este periodo",
            )
        )
    try:
        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.executemany(insert_sql, rows)
            conn.commit()
    except Exception as e:
        # No bloquear el scrape si DB falla — solo log
        click.echo(f"     WARN: no pude registrar no-publicados en DB: {e}")


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


@import_grp.command("monthly-eeff")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=10_000)
def import_monthly_eeff(path: str, batch_size: int) -> None:
    """Cargar .xls mensual SBS (un archivo o un directorio recursivo).

    Si PATH es un archivo .xls: lo procesa.
    Si PATH es un directorio: procesa todos los .xls recursivamente.
    """
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyEeffImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyEeffImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="eeff")
                        await conn.commit()
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>7,}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()

        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    import contextlib

    asyncio.run(_run())


@import_grp.command("monthly-oficinas-grid")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=5_000)
def import_monthly_oficinas_grid(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico oficinas (grid empresa x departamento).

    Procesa los archivos descargados con `aibenchef scrape --topico oficinas`
    a la tabla raw.oficinas_observacion (B-2303 / B-3201 / C-1201 / C-2201 / C-4205).
    Distinto de monthly-oficinas que procesa creditos_depositos_geo.
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyOficinasGridImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    files = [p] if p.is_file() else sorted(p.rglob("*.xls"))
    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyOficinasGridImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="oficinas")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>4}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>4}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-oficinas")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=5_000)
def import_monthly_oficinas(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico 08 (CREDITOS_Y_DEPOSITOS_GEOGRAFICA).

    Procesa los archivos descargados con `aibenchef scrape --topico
    creditos_depositos_geo` a la tabla raw.creditos_depositos_oficina.

    Si PATH es un archivo .xls: lo procesa.
    Si PATH es un directorio: procesa todos los .xls recursivamente.

    Ejemplos:
        aibenchef import monthly-oficinas ./local-data/raw
        aibenchef import monthly-oficinas "D:/PROYECTO/SBS/Extraer data de pagina SBS/01_Entidad_Banca_Multiple/08_CREDITOS_Y_DEPOSITOS_GEOGRAFICA_SBS"
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyOficinasImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyOficinasImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="oficinas")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>7,}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors[:3]:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-clientes")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_clientes(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico 05 (CLIENTES_CREDITO).

    Procesa los archivos descargados con `aibenchef scrape --topico
    clientes_credito` a la tabla raw.clientes_creditos.

    Inserta UNA fila por (periodo, empresa) con producto='TOTAL' y
    n_clientes = Total de deudores (ultima columna del .xls SBS).
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyClientesImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyClientesImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(
                            importer, f, topico="clientes_credito"
                        )
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors[:3]:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-personal")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_personal(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico 09 (PERSONAL).

    Procesa los archivos descargados con `aibenchef scrape --topico
    personal` a la tabla raw.personal_observacion.

    Inserta UNA fila por (periodo, empresa_sbs) con gerentes/funcionarios/
    empleados/otros/total.
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyPersonalImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyPersonalImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="personal")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors[:3]:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-indicadores")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_indicadores(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico indicadores prudenciales (topico 10).

    Procesa el reporte SBS consolidado de indicadores financieros (B-2401,
    B-3301, C-1301, C-2301, C-4301) a raw.indicadores_prudenciales en
    formato long: 1 fila por (periodo, tipo_entidad, entidad, indicador).

    Cubre las 5 secciones: SOLVENCIA, CALIDAD_ACTIVOS, EFICIENCIA,
    RENTABILIDAD, LIQUIDEZ.
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyIndicadoresImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyIndicadoresImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="indicadores")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors[:3]:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-colocaciones")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_colocaciones(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico colocaciones (creditos por tipo).

    Detecta automaticamente layout horizontal (BANCA/FINANCIERA) o
    transpuesto (CMAC/CRAC/EDPYME). Carga raw.colocaciones_observacion
    con productos: Corporativo, Grandes/Medianas/Pequena Empresa,
    Microempresa, Consumo, Hipotecario.
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyColocacionesImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyColocacionesImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="colocaciones")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors[:3]:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-depositos")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_depositos(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico depositos.

    Suma todas las columnas numericas por entidad y guarda saldo_total
    con producto='TOTAL' en raw.depositos_observacion.
    """
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyDepositosImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(p.rglob("*.xls"))
    else:
        raise click.ClickException(f"Path no es archivo ni directorio: {path}")

    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyDepositosImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="depositos")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                        for err in result.errors[:3]:
                            click.echo(f"      ! {err}")
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-clientes-ahorro")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_clientes_ahorro(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico clientes_ahorro (numero de personas con depositos)."""
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyClientesAhorroImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    files = [p] if p.is_file() else sorted(p.rglob("*.xls"))
    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyClientesAhorroImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(
                            importer, f, topico="clientes_ahorro"
                        )
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


@import_grp.command("monthly-castigos")
@click.argument(
    "path",
    type=click.Path(exists=True, path_type=str),
)
@click.option("--batch-size", type=int, default=1_000)
def import_monthly_castigos(path: str, batch_size: int) -> None:
    """Cargar .xls mensuales SBS topico castigos (flujo mensual)."""
    import asyncio
    import contextlib
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import MonthlyCastigosImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = _P(path)
    files = [p] if p.is_file() else sorted(p.rglob("*.xls"))
    if not files:
        click.echo(f"# (no se encontraron .xls bajo {path})")
        return

    click.echo(f"# {len(files)} archivos a procesar")

    async def _run() -> None:
        await open_pool()
        total_inserted = 0
        total_errors = 0
        try:
            async with connection() as conn:
                importer = MonthlyCastigosImporter(conn, batch_size=batch_size)
                for i, f in enumerate(files, start=1):
                    try:
                        result = await _import_file_with_audit(importer, f, topico="castigos")
                        total_inserted += result.rows_inserted
                        if result.errors:
                            total_errors += len(result.errors)
                        status = "OK" if not result.errors else f"ERR x{len(result.errors)}"
                        click.echo(
                            f"  [{i:>3}/{len(files)}] {f.name:<40} "
                            f"rows={result.rows_inserted:>5}  ({result.duration_seconds:.1f}s)  {status}"
                        )
                    except Exception as e:
                        total_errors += 1
                        click.echo(f"  [{i:>3}/{len(files)}] {f.name:<40} FATAL: {e}")
                        with contextlib.suppress(Exception):
                            await conn.rollback()
        finally:
            await close_pool()
        click.echo("")
        click.echo(f"# TOTAL: {total_inserted:,} filas insertadas, {total_errors} errores")

    asyncio.run(_run())


# Mapeo topico -> (importer_class_name, audit_topico_name).
# Usado por `import all-monthly` para iterar sobre todos los topicos de un periodo.
# Importante: el `audit_topico_name` es el string que `_import_file_with_audit`
# escribe en raw.archivos_descargados.topico_norm — debe matchear lo que ya
# graba storage scan y el resto de la CLI.
_MONTHLY_TOPICO_IMPORTERS: list[tuple[str, str, str]] = [
    # (topico_db, importer_class_name, audit_topico)
    ("eeff", "MonthlyEeffImporter", "eeff"),
    ("oficinas", "MonthlyOficinasGridImporter", "oficinas"),
    ("creditos_depositos_geo", "MonthlyOficinasImporter", "creditos_depositos_geo"),
    ("clientes_credito", "MonthlyClientesImporter", "clientes_credito"),
    ("clientes_ahorro", "MonthlyClientesAhorroImporter", "clientes_ahorro"),
    ("personal", "MonthlyPersonalImporter", "personal"),
    ("indicadores", "MonthlyIndicadoresImporter", "indicadores"),
    ("colocaciones", "MonthlyColocacionesImporter", "colocaciones"),
    ("depositos", "MonthlyDepositosImporter", "depositos"),
    ("castigos", "MonthlyCastigosImporter", "castigos"),
]


@import_grp.command("all-monthly")
@click.option(
    "--periodo",
    type=str,
    required=True,
    help="YYYYMM. Procesa todos los archivos del periodo en estado 'descargado'.",
)
@click.option(
    "--batch-size",
    type=int,
    default=5_000,
    show_default=True,
    help="Filas por batch para todos los importers.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Lista archivos candidatos sin ejecutar imports.",
)
def import_all_monthly(periodo: str, batch_size: int, dry_run: bool) -> None:
    """Procesa todos los topicos monthly-* de un periodo en una sola corrida.

    Wrapper sobre los 10 comandos monthly-*. Fix de #126 para cerrar el flujo
    automatizado: scrape -> storage scan -> all-monthly -> procesado.

    Estrategia:
    1. Para cada topico, consulta raw.archivos_descargados con periodo=X y
       status='descargado'.
    2. Llama al importer correspondiente. `_import_file_with_audit` actualiza
       status a 'procesado' o 'error'.
    3. Devuelve resumen agregado.
    """
    import asyncio
    import contextlib
    import importlib
    from pathlib import Path as _P

    import psycopg

    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    try:
        periodo_int = int(periodo)
        if not (200001 <= periodo_int <= 209912):
            raise ValueError
    except ValueError as exc:
        raise click.UsageError(f"--periodo debe ser YYYYMM valido (recibido: {periodo})") from exc

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    # 1. Cargar mapa topico -> [path_local, ...] desde DB.
    archivos_por_topico: dict[str, list[str]] = {}
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT topico, path_local
            FROM raw.archivos_descargados
            WHERE periodo = %s AND status = 'descargado'
            ORDER BY topico, path_local
            """,
            (periodo_int,),
        )
        for topico_db, path_local in cur.fetchall():
            archivos_por_topico.setdefault(topico_db, []).append(path_local)

    total_archivos = sum(len(v) for v in archivos_por_topico.values())
    click.echo(
        f"# periodo={periodo_int} archivos_descargado={total_archivos} "
        f"topicos={sorted(archivos_por_topico.keys())}"
    )

    if total_archivos == 0:
        click.echo("# Nada que importar (no hay archivos en estado 'descargado').")
        return

    if dry_run:
        for topico, paths in archivos_por_topico.items():
            click.echo(f"  [dry] {topico}: {len(paths)} archivos")
            for p in paths:
                click.echo(f"        ~ {p}")
        return

    loading_module = importlib.import_module("aibenchef_data.domains.loading")

    grand_inserted = 0
    grand_errors = 0
    grand_ok = 0
    grand_fail = 0

    async def _run_topico(topico_db: str, importer_class_name: str, audit_topico: str) -> None:
        """Procesa un topico. Asume que el pool global ya esta abierto."""
        nonlocal grand_inserted, grand_errors, grand_ok, grand_fail
        paths = archivos_por_topico.get(topico_db, [])
        if not paths:
            return

        importer_cls = getattr(loading_module, importer_class_name, None)
        if importer_cls is None:
            click.echo(f"  ! topico={topico_db}: importer {importer_class_name} no existe (skip)")
            return

        click.echo(f"\n## topico={topico_db} archivos={len(paths)} importer={importer_class_name}")

        async with connection() as conn:
            importer = importer_cls(conn, batch_size=batch_size)
            for i, p_str in enumerate(paths, start=1):
                f = _P(p_str)
                if not f.exists():
                    grand_fail += 1
                    click.echo(f"  [{i:>3}/{len(paths)}] {f.name:<40} SKIP: no existe en disco")
                    continue
                try:
                    result = await _import_file_with_audit(importer, f, topico=audit_topico)
                    grand_inserted += result.rows_inserted
                    if result.errors:
                        grand_errors += len(result.errors)
                        grand_fail += 1
                        status_str = f"ERR x{len(result.errors)}"
                    else:
                        grand_ok += 1
                        status_str = "OK"
                    click.echo(
                        f"  [{i:>3}/{len(paths)}] {f.name:<40} "
                        f"rows={result.rows_inserted:>7,}  "
                        f"({result.duration_seconds:.1f}s)  {status_str}"
                    )
                except Exception as e:
                    grand_fail += 1
                    grand_errors += 1
                    click.echo(f"  [{i:>3}/{len(paths)}] {f.name:<40} FATAL: {e}")
                    with contextlib.suppress(Exception):
                        await conn.rollback()

    async def _main() -> None:
        # Pool abierto UNA vez para todos los topicos. psycopg_pool no permite
        # reabrir un pool cerrado — abrir/cerrar por topico tira PoolClosed
        # al segundo topico (bug #126 fase 2).
        await open_pool()
        try:
            for topico_db, importer_name, audit_name in _MONTHLY_TOPICO_IMPORTERS:
                await _run_topico(topico_db, importer_name, audit_name)
        finally:
            await close_pool()

    asyncio.run(_main())

    click.echo("")
    click.echo(
        f"# TOTAL periodo={periodo_int}: "
        f"OK={grand_ok}  FAIL={grand_fail}  "
        f"rows_insertadas={grand_inserted:,}  errores={grand_errors}"
    )


def _run_simple_import(importer_cls, path: str, sheet: str | None, batch_size: int) -> None:
    """Helper para correr un importer simple con DB pool + commit."""
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    async def _run() -> None:
        await open_pool()
        try:
            async with connection() as conn:
                imp = importer_cls(conn, batch_size=batch_size)
                if sheet is not None:
                    result = await imp.import_file(_P(path), sheet=sheet)
                else:
                    result = await imp.import_file(_P(path))
                await conn.commit()
                click.echo(
                    f"# Import {result.source_file}:\n"
                    f"  rows_inserted: {result.rows_inserted:,}\n"
                    f"  rows_skipped:  {result.rows_skipped:,}\n"
                    f"  duration:      {result.duration_seconds:.1f}s\n"
                    f"  errors:        {len(result.errors)}"
                )
                for err in list(result.errors)[:20]:
                    click.echo(f"  ERROR: {err}")
        finally:
            await close_pool()

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Helper compartido para monthly imports con audit trail (issue #18, G1+G2).
# ---------------------------------------------------------------------------


def _extract_periodo_from_path(path: Path) -> int | None:
    """Extrae periodo YYYYMM del filename SBS estándar.

    Patrón: -<mes_abrev><anio>.xls (ej. B-2369-ma2010.xls → 201003).
    Retorna None si no matchea (caller decide si loggear o ignorar).
    """
    import re as _re

    mes_abrev_to_num = {
        "en": 1,
        "fe": 2,
        "ma": 3,
        "ab": 4,
        "my": 5,
        "ju": 6,
        "jl": 7,
        "ag": 8,
        "se": 9,
        "oc": 10,
        "no": 11,
        "di": 12,
    }
    name = path.stem.lower()
    m = _re.search(r"-([a-z]{2})(\d{4})$", name)
    if not m:
        return None
    mes = mes_abrev_to_num.get(m.group(1))
    anio = int(m.group(2))
    if not mes or not (2000 <= anio <= 2050):
        return None
    return anio * 100 + mes


async def _import_file_with_audit(
    importer,
    file: Path,
    *,
    topico: str,
    triggered_by: str = "cli",
    sync_job_id: int | None = None,
):
    """Wrapper para import_file que escribe audit trail (issue #18).

    Hace 3 cosas que el importer no hace por sí solo:
    1. Crea fila en raw.carga_log con stage='import', status='running' (G2)
    2. Llama importer.import_file(file) y guarda contadores en el row
    3. UPDATE raw.archivos_descargados.status='procesado'|'error' (G1)
    4. UPDATE carga_log al estado final con metadata (layout, sheets, errors)

    Diseñado para usarse DENTRO del loop del importer en cada
    `import_monthly_*` command de la CLI:

        result = await _import_file_with_audit(importer, f, topico='eeff')

    En lugar de:

        result = await importer.import_file(f)
    """
    import time

    from aibenchef_data.domains.shared import (
        carga_log_context,
        check_partial_ingest,
        mark_archivo_error,
        mark_archivo_procesado,
        mark_archivo_sospechoso,
        resolve_archivo_id,
    )
    from aibenchef_data.infrastructure.db import connection

    # Resolver archivo_id (puede ser None si el archivo no está en
    # raw.archivos_descargados — ej. import puntual de un xls local).
    async with connection() as conn_lookup:
        archivo_id = await resolve_archivo_id(conn_lookup, path_local=str(file))

    periodo = _extract_periodo_from_path(file)

    async with carga_log_context(
        connection,
        stage="import",
        topico=topico,
        periodo=periodo,
        archivo_id=archivo_id,
        triggered_by=triggered_by,
        sync_job_id=sync_job_id,
        source_file=file.name,
    ) as log:
        try:
            t0 = time.monotonic()
            # Solo monthly_eeff hoy consume archivo_id (issue #65). Probar
            # con kwarg y caer al call original si el importer no lo acepta —
            # asi no rompemos los otros importers (oficinas, depositos, etc).
            try:
                result = await importer.import_file(file, archivo_id=archivo_id)
            except TypeError:
                result = await importer.import_file(file)
            duration = time.monotonic() - t0
        except Exception as exc:
            # Marca archivo como error antes de re-raise (carga_log_context
            # marca su row como failed automáticamente).
            if archivo_id is not None:
                try:
                    async with connection() as conn_err:
                        await mark_archivo_error(
                            conn_err,
                            archivo_id=archivo_id,
                            error_mensaje=f"{type(exc).__name__}: {exc}",
                        )
                        await conn_err.commit()
                except Exception:
                    pass  # best-effort
            raise

        # Importer terminó OK (con o sin errores parciales en result.errors)
        log.rows_inserted = result.rows_inserted
        log.rows_skipped = getattr(result, "rows_skipped", 0)
        log.metadata["duration_s"] = round(duration, 2)
        if result.errors:
            log.metadata["errors"] = [str(e)[:200] for e in result.errors[:5]]
            log.metadata["n_errors"] = len(result.errors)

        # G1: marca archivo como procesado solo si NO hubo errores parciales
        # (si los hay, queda en 'error' para inspección humana).
        # G1.5 (V135): si NO hubo errores, correr detect_partial_ingest y si
        # detecta carga sospechosa (rows << promedio historico), degradar el
        # estado a 'sospechoso'. Cierra el gap del incidente C-4103-my2026:
        # archivo SBS truncado que carga sin excepcion, marcado 'procesado'
        # invisible, dejando el peer group entero en "—".
        if archivo_id is not None:
            try:
                async with connection() as conn_mark:
                    if result.errors:
                        await mark_archivo_error(
                            conn_mark,
                            archivo_id=archivo_id,
                            error_mensaje=f"Parsed con {len(result.errors)} errores; rows_inserted={result.rows_inserted}",
                        )
                        await conn_mark.commit()
                    else:
                        await mark_archivo_procesado(
                            conn_mark,
                            archivo_id=archivo_id,
                            filas_insertadas=result.rows_inserted,
                        )
                        await conn_mark.commit()
                        check = await check_partial_ingest(conn_mark, archivo_id=archivo_id)
                        if check is not None:
                            log.metadata["partial_ingest_check"] = check
                        if check and check.get("ok") is False:
                            reason = check.get("reason", "unknown")
                            ratio = check.get("ratio")
                            rows_prom = check.get("rows_promedio")
                            msg = (
                                f"Carga sospechosa (reason={reason}, "
                                f"rows={result.rows_inserted} vs prom={rows_prom}, "
                                f"ratio={ratio}). Re-encolar con "
                                f"force_redownload=true si SBS ya publico corregido."
                            )
                            log.metadata["marked_sospechoso"] = True
                            await mark_archivo_sospechoso(
                                conn_mark,
                                archivo_id=archivo_id,
                                filas_insertadas=result.rows_inserted,
                                error_mensaje=msg,
                            )
                            await conn_mark.commit()
            except Exception:
                # Best-effort. Si el UPDATE falla no es razón para fallar el import.
                pass

        return result


@import_grp.command("base-patrimonio")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="Data")
@click.option("--batch-size", type=int, default=5_000)
def import_base_patrimonio(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE PATRIMONIO EFECTIVO.xlsx a raw.patrimonio_efectivo."""
    from aibenchef_data.domains.loading import BasePatrimonioImporter

    _run_simple_import(BasePatrimonioImporter, path, sheet, batch_size)


@import_grp.command("base-ratio-liquidez")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="Data")
@click.option("--batch-size", type=int, default=5_000)
def import_base_ratio_liquidez(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE_RATIO_LIQUIDEZ.xlsx a raw.ratio_liquidez."""
    from aibenchef_data.domains.loading import BaseRatioLiquidezImporter

    _run_simple_import(BaseRatioLiquidezImporter, path, sheet, batch_size)


@import_grp.command("base-rcg")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="DATA")
@click.option("--batch-size", type=int, default=5_000)
def import_base_rcg(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE_RCG.xlsx a raw.ratio_capital_global (Basilea III)."""
    from aibenchef_data.domains.loading import BaseRcgImporter

    _run_simple_import(BaseRcgImporter, path, sheet, batch_size)


@import_grp.command("base-personal")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="Base")
@click.option("--batch-size", type=int, default=5_000)
def import_base_personal(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE PERSONAL.xlsx a raw.personal_observacion (headcount)."""
    from aibenchef_data.domains.loading import BasePersonalImporter

    _run_simple_import(BasePersonalImporter, path, sheet, batch_size)


@import_grp.command("base-clientes-ahorros")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="2.BDClieAho")
@click.option("--batch-size", type=int, default=10_000)
def import_base_clientes_ahorros(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE CLIENTES AHORROS.xlsx a raw.clientes_ahorros."""
    from aibenchef_data.domains.loading import BaseClientesAhorrosImporter

    _run_simple_import(BaseClientesAhorrosImporter, path, sheet, batch_size)


@import_grp.command("base-clientes-creditos")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="1.BDClieCred")
@click.option("--batch-size", type=int, default=10_000)
def import_base_clientes_creditos(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE CLIENTES CREDITOS.xlsx a raw.clientes_creditos."""
    from aibenchef_data.domains.loading import BaseClientesCreditosImporter

    _run_simple_import(BaseClientesCreditosImporter, path, sheet, batch_size)


@import_grp.command("base-oficinas")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option(
    "--sheet",
    type=str,
    default="auto",
    help='Nombre de hoja exacta, o "auto" para concatenar todas las que '
    'empiezen con "DataSF" (DataSF, DataSF_2, etc.).',
)
@click.option("--batch-size", type=int, default=20_000)
def import_base_oficinas(path: str, sheet: str, batch_size: int) -> None:
    """Cargar CREDITOS Y DEPOSITOS POR OFICINAS.xlsx (~1M filas) a raw.creditos_depositos_oficina.

    Por default lee todas las hojas DataSF, DataSF_2, ... (cuando el xlsx
    supera el limite de Excel se parte en varias hojas).
    """
    from aibenchef_data.domains.loading import BaseOficinasImporter

    _run_simple_import(BaseOficinasImporter, path, sheet, batch_size)


@import_grp.command("base-creditos-distrito")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="BD")
@click.option("--batch-size", type=int, default=10_000)
def import_base_creditos_distrito(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE_Creditos_por_tipo_distrito.xlsx a raw.creditos_distrito."""
    from aibenchef_data.domains.loading import BaseCreditosDistritoImporter

    _run_simple_import(BaseCreditosDistritoImporter, path, sheet, batch_size)


@import_grp.command("base-tasas-activas")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="Data")
@click.option("--batch-size", type=int, default=10_000)
def import_base_tasas_activas(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE TASAS ACTIVAS.xlsx a raw.tasas_activas (con unpivot)."""
    from aibenchef_data.domains.loading import BaseTasasActivasImporter

    _run_simple_import(BaseTasasActivasImporter, path, sheet, batch_size)


@import_grp.command("base-tasas-pasivas")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="DATA PASIVAS")
@click.option("--batch-size", type=int, default=10_000)
def import_base_tasas_pasivas(path: str, sheet: str, batch_size: int) -> None:
    """Cargar BASE TASAS PASIVAS.xlsx a raw.tasas_pasivas (con unpivot, header row 2)."""
    from aibenchef_data.domains.loading import BaseTasasPasivasImporter

    _run_simple_import(BaseTasasPasivasImporter, path, sheet, batch_size)


@import_grp.command("base-depositos")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="4.BDAhorros")
@click.option("--batch-size", type=int, default=10_000)
def import_base_depositos(path: str, sheet: str, batch_size: int) -> None:
    """Bootstrap historico: cargar BASE DEPOSITOS.xlsx a raw.depositos_observacion."""
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import BaseDepositosImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    async def _run() -> None:
        await open_pool()
        try:
            async with connection() as conn:
                imp = BaseDepositosImporter(conn, batch_size=batch_size)
                result = await imp.import_file(_P(path), sheet=sheet)
                await conn.commit()
                click.echo(
                    f"# Import {result.source_file}:\n"
                    f"  rows_inserted: {result.rows_inserted:,}\n"
                    f"  duration:      {result.duration_seconds:.1f}s\n"
                    f"  errors:        {len(result.errors)}"
                )
        finally:
            await close_pool()

    asyncio.run(_run())


@import_grp.command("base-castigos")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=str))
@click.option("--sheet", type=str, default="Castigos")
@click.option("--batch-size", type=int, default=10_000)
def import_base_castigos(path: str, sheet: str, batch_size: int) -> None:
    """Bootstrap historico: cargar BASE CASTIGOS.xlsx a raw.castigos_observacion."""
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import BaseCastigosImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    async def _run() -> None:
        await open_pool()
        try:
            async with connection() as conn:
                imp = BaseCastigosImporter(conn, batch_size=batch_size)
                result = await imp.import_file(_P(path), sheet=sheet)
                await conn.commit()
                click.echo(
                    f"# Import {result.source_file}:\n"
                    f"  rows_inserted: {result.rows_inserted:,}\n"
                    f"  duration:      {result.duration_seconds:.1f}s\n"
                    f"  errors:        {len(result.errors)}"
                )
        finally:
            await close_pool()

    asyncio.run(_run())


@import_grp.command("base-colocaciones")
@click.argument(
    "path",
    type=click.Path(exists=True, dir_okay=False, path_type=str),
)
@click.option("--sheet", type=str, default="3.BDCreditos", help="Hoja con los datos tidy")
@click.option("--batch-size", type=int, default=10_000)
def import_base_colocaciones(path: str, sheet: str, batch_size: int) -> None:
    """Bootstrap historico: cargar BASE COLOCACIONES.xlsx a raw.colocaciones_observacion."""
    import asyncio
    from pathlib import Path as _P

    from aibenchef_data.domains.loading import BaseColocacionesImporter
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    async def _run() -> None:
        await open_pool()
        try:
            async with connection() as conn:
                importer = BaseColocacionesImporter(conn, batch_size=batch_size)
                result = await importer.import_file(_P(path), sheet=sheet)
                await conn.commit()
                click.echo(
                    f"# Import {result.source_file}:\n"
                    f"  rows_inserted: {result.rows_inserted:,}\n"
                    f"  duration:      {result.duration_seconds:.1f}s\n"
                    f"  errors:        {len(result.errors)}"
                )
                for err in result.errors[:20]:
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


# ============================================================================
# pipeline — Comandos de observabilidad del pipeline de datos (issue #18)
# ============================================================================


@main.group("pipeline")
def pipeline_grp() -> None:
    """Observabilidad del pipeline: post-import-check, audit, status."""


@pipeline_grp.command("refresh-marts")
@click.option(
    "--concurrent/--no-concurrent",
    default=False,
    show_default=True,
    help=(
        "Usar REFRESH MATERIALIZED VIEW CONCURRENTLY (no bloquea reads pero "
        "es muy lento en MVs grandes — eeff_*_ancho tarda 15+ min). "
        "Default (no-concurrent) bloquea reads brevemente pero es mucho mas rapido. "
        "Para correr post-import en cron, dejar default."
    ),
)
def pipeline_refresh_marts(concurrent: bool) -> None:
    """Refresca las 24 MVs marts.* tras un import.

    Llama marts.refresh_all_marts(p_concurrent) creada en V133. Reporta una
    fila por MV con duracion + success/error.

    NOTA: este comando NO recalcula dw.entidad_microfinanciera_periodo ni
    refresh_kpis_anuales. Para post-import completo, usar `refresh-derived`.
    """
    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    click.echo(
        f"# refresh-marts iniciado (concurrent={concurrent}). "
        f"Sin --concurrent las MVs bloquean reads brevemente; "
        f"con --concurrent es mucho mas lento. Tiempo estimado: 15-60 min."
    )
    total = 0
    ok = 0
    fail = 0
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT mv_name, duration_ms, success, COALESCE(error,'') "
            "FROM marts.refresh_all_marts(%s)",
            (concurrent,),
        )
        for mv, duration_ms, success, error in cur.fetchall():
            total += 1
            status = "OK" if success else "FAIL"
            if success:
                ok += 1
            else:
                fail += 1
            click.echo(f"  [{status}] {mv:<48} {duration_ms:>8} ms  {error}")
    click.echo("")
    click.echo(f"# TOTAL: {total} MVs procesadas — OK={ok}, FAIL={fail}")


@pipeline_grp.command("refresh-derived")
@click.option(
    "--periodo",
    type=str,
    default=None,
    help="YYYYMM. Si vacio recalcula TODO el historico (caro, evitar en cron).",
)
@click.option(
    "--concurrent/--no-concurrent",
    default=False,
    show_default=True,
    help="Refresh CONCURRENTLY de las MVs (lento, pero no bloquea reads).",
)
@click.option(
    "--triggered-by",
    type=str,
    default="cli:manual",
    help="Etiqueta para admin.mv_refresh_log (cli:cron, sync_job:123, etc).",
)
def pipeline_refresh_derived(periodo: str | None, concurrent: bool, triggered_by: str) -> None:
    """Orquesta TODOS los recalculos derivados tras un import.

    Llama marts.refresh_all_derived_logged(periodo, concurrent, triggered_by)
    creada en V137 (wrapper de la V134 que persiste en admin.mv_refresh_log):
      1. dw.recalcular_microfinancieras(periodo)  -> cartera_mype, smf flags
      2. marts.refresh_kpis_anuales()             -> kpis_anuales_entidad/historica
      3. marts.refresh_all_marts(concurrent)      -> 24 MVs marts.*

    Sin esto, el dashboard muestra celdas vacias (caso real: 'Cartera MYPE /
    Total %' aparecio en blanco para abril 2026 porque
    dw.entidad_microfinanciera_periodo no se recalculo post-import).

    Idempotente. Para post-import del cron, pasar --periodo explicito para
    evitar recalcular TODO el historico. Cada corrida queda registrada en
    admin.mv_refresh_log para /dashboard/admin/data-quality (freshness).
    """
    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    periodo_int: int | None = None
    if periodo:
        try:
            periodo_int = int(periodo)
            if not (200001 <= periodo_int <= 209912):
                raise ValueError
        except ValueError as exc:
            raise click.UsageError(
                f"--periodo debe ser YYYYMM valido (recibido: {periodo})"
            ) from exc

    click.echo(
        f"# refresh-derived periodo={periodo or 'TODOS'} concurrent={concurrent} "
        f"triggered_by={triggered_by}"
    )
    grand_ok = 0
    grand_fail = 0
    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
        # Fallback graceful si la DB aun no tiene V137 (rollback deploy):
        # intentamos _logged primero, si no existe usamos la version base.
        try:
            cur.execute(
                "SELECT step_name, duration_ms, success, COALESCE(detail,'') "
                "FROM marts.refresh_all_derived_logged(%s, %s, %s)",
                (periodo_int, concurrent, triggered_by),
            )
        except psycopg.errors.UndefinedFunction:
            conn.rollback()
            cur.execute(
                "SELECT step_name, duration_ms, success, COALESCE(detail,'') "
                "FROM marts.refresh_all_derived(%s, %s)",
                (periodo_int, concurrent),
            )
        for step, duration_ms, success, detail in cur.fetchall():
            status = "OK" if success else "FAIL"
            if success:
                grand_ok += 1
            else:
                grand_fail += 1
            click.echo(f"  [{status}] {step:<40} {duration_ms:>8} ms  {detail}")
    click.echo("")
    click.echo(f"# TOTAL: pasos OK={grand_ok}, FAIL={grand_fail}")


@pipeline_grp.command("post-import-check")
@click.option(
    "--periodo",
    type=str,
    required=True,
    help="YYYYMM del periodo a validar contra dw.cabecera_maestra.",
)
@click.option(
    "--grupo",
    type=click.Choice(["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"]),
    multiple=True,
    default=None,
    help="Validar solo estos grupos. Vacio = todos.",
)
@click.option(
    "--triggered-by",
    type=str,
    default="cli",
    help="Origen del run: cron | manual:<email> | cli:<user>.",
)
def pipeline_post_import_check(
    periodo: str,
    grupo: tuple[str, ...],
    triggered_by: str,
) -> None:
    """Compara archivos del periodo vs cabecera_maestra y PERSISTE diffs.

    Diferencia vs `catalog detectar-cambios`: este comando guarda los
    resultados en admin.estructura_diffs para que el dashboard
    /admin/pipeline pueda mostrarlos y el operador marcar como revisados.

    Idealmente se invoca automaticamente tras el sync mensual SBS:

        aibenchef sbs work-jobs   # scrape + import
        aibenchef pipeline post-import-check --periodo 202604 --triggered-by cron

    Cierra G3 del audit de observabilidad (issue #18). Cada corrida del
    detector queda registrada en raw.carga_log con stage='detectar-cambios'.
    """
    import asyncio
    from pathlib import Path as _P

    import psycopg as _ps

    from aibenchef_data.domains.catalog.services import (
        compare_periodo_vs_cabecera,
    )
    from aibenchef_data.domains.shared import (
        carga_log_context,
    )
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = Periodo.from_yyyymm(periodo)
    grupos_filter = list(grupo) if grupo else None
    storage_root = _P("./local-data/raw").resolve()

    if not storage_root.is_dir():
        raise click.ClickException(
            f"Storage root no existe: {storage_root}. "
            "Corre `aibenchef scrape ...` primero o ajusta RAW_STORAGE_DIR."
        )

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    async def _run() -> None:
        await open_pool()
        try:
            async with carga_log_context(
                connection,
                stage="detectar-cambios",
                periodo=p.to_int(),
                triggered_by=triggered_by,
                initial_metadata={"grupos": grupos_filter},
            ) as log:
                # Conexion sincrona para la comparacion (read-only del schema dw).
                with _ps.connect(url, connect_timeout=10) as sync_conn:
                    diffs = compare_periodo_vs_cabecera(
                        sync_conn,
                        periodo=p.to_int(),
                        storage_root=storage_root,
                        grupos=grupos_filter,
                    )

                # Persistir cada diff en admin.estructura_diffs.
                total_diffs_count = 0
                total_warning_count = 0
                total_critical_count = 0

                async with connection() as conn_write:
                    async with conn_write.cursor() as cur:
                        for d in diffs:
                            await cur.execute(
                                """
                                INSERT INTO admin.estructura_diffs (
                                    periodo, grupo, topico, tipo_estado,
                                    carga_log_id,
                                    n_renames, n_extras, n_missing,
                                    severity, payload
                                )
                                VALUES (
                                    %s, %s, 'eeff', %s,
                                    %s,
                                    %s, %s, %s,
                                    %s, %s
                                )
                                """,
                                (
                                    d.periodo,
                                    d.grupo,
                                    d.tipo_estado,
                                    log.log_id,
                                    d.n_renames,
                                    d.n_extras,
                                    d.n_missing,
                                    d.severity,
                                    _Json(d.to_payload()),
                                ),
                            )
                            total_diffs_count += d.total_diffs
                            if d.severity == "warning":
                                total_warning_count += 1
                            elif d.severity == "critical":
                                total_critical_count += 1

                            click.echo(
                                f"  [{d.grupo:<12} {d.tipo_estado:<11}] "
                                f"{d.archivo:<25}  "
                                f"renames={d.n_renames:>2}  "
                                f"extras={d.n_extras:>2}  "
                                f"missing={d.n_missing:>2}  "
                                f"severity={d.severity}"
                            )
                    await conn_write.commit()

                log.rows_inserted = len(diffs)
                log.metadata["total_diffs"] = total_diffs_count
                log.metadata["warning_count"] = total_warning_count
                log.metadata["critical_count"] = total_critical_count

                click.echo("")
                click.echo(
                    f"# Persisted {len(diffs)} diff rows for periodo {periodo}: "
                    f"{total_warning_count} warning, {total_critical_count} critical."
                )
                if total_warning_count or total_critical_count:
                    click.echo(
                        "# Revisa: SELECT * FROM admin.estructura_diffs "
                        "WHERE reviewed_at IS NULL AND severity != 'info';"
                    )
        finally:
            await close_pool()

    # Import lazy del Json psycopg para evitar problemas en tiempo de carga del módulo.
    from psycopg.types.json import Json as _Json

    asyncio.run(_run())


@pipeline_grp.command("quality-check")
@click.option(
    "--periodo",
    type=str,
    required=True,
    help="YYYYMM del periodo a chequear.",
)
@click.option(
    "--triggered-by",
    type=str,
    default="cli",
    help="Origen del run: cron | manual:<email> | cli:<user>.",
)
def pipeline_quality_check(periodo: str, triggered_by: str) -> None:
    """Corre los 3 chequeos de data quality V2 y persiste en admin.data_quality_checks.

    Cierra el gap V2 (issue #24): valida coherencia SEMANTICA de los EEFF
    despues del import, no solo coherencia estructural.

    Checks:
      1. balance_contable — Activos = Pasivos + Patrimonio (BANCOS + FIN)
      2. outlier_zscore  — valor actual vs media+stddev 11m previos
      3. suma_subcuentas — padre = SUM(hijos directos) (BANCOS + FIN)

    Cada resultado queda persistido con status (ok/warning/critical) y
    payload JSONB para inspeccion en /dashboard/admin/pipeline.

    Ideal correr automaticamente tras `aibenchef sbs work-jobs`:

        aibenchef sbs work-jobs                                # scrape + import
        aibenchef pipeline post-import-check --periodo 202604  # G3: estructura
        aibenchef pipeline quality-check --periodo 202604      # V2: semantica
    """
    import asyncio

    from aibenchef_data.domains.shared import carga_log_context
    from aibenchef_data.infrastructure.db import close_pool, connection, open_pool

    p = Periodo.from_yyyymm(periodo)

    async def _run() -> None:
        await open_pool()
        try:
            async with carga_log_context(
                connection,
                stage="detectar-cambios",  # reusa stage existente (V1)
                periodo=p.to_int(),
                triggered_by=triggered_by,
                initial_metadata={"v2_quality_check": True},
            ) as log:
                async with connection() as conn:
                    # Para cada check ejecutamos la vista correspondiente,
                    # filtramos solo status != 'ok' (los OK no se persisten
                    # para no saturar la tabla) y bulk-insertamos.
                    n_ok = 0
                    n_warning = 0
                    n_critical = 0

                    # --- Check 1: balance_contable ---
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            INSERT INTO admin.data_quality_checks
                                (periodo, nomb_correg, check_type, carga_log_id,
                                 status, expected_value, actual_value, delta_abs,
                                 delta_pct, payload)
                            SELECT
                                %s, nomb_correg, 'balance_contable', %s,
                                status, expected_value, actual_value, delta_abs,
                                delta_pct,
                                jsonb_build_object(
                                    'tipo_entidad', tipo_entidad,
                                    'activos', activos,
                                    'pasivos', pasivos,
                                    'patrimonio', patrimonio
                                )
                            FROM marts.v_dq_balance
                            WHERE periodo = %s AND status != 'ok'
                            """,
                            (p.to_int(), log.log_id, p.to_int()),
                        )
                        click.echo(f"  Check 1 (balance):     {cur.rowcount} anomalías")

                    # --- Check 2: outlier_zscore ---
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            INSERT INTO admin.data_quality_checks
                                (periodo, nomb_correg, check_type, cuenta_codigo,
                                 carga_log_id, status, actual_value, z_score, payload)
                            SELECT
                                %s, nomb_correg, 'outlier_zscore', cuenta_codigo,
                                %s, status, valor, z_score,
                                jsonb_build_object(
                                    'media_11m', media_11m,
                                    'stddev_11m', stddev_11m
                                )
                            FROM marts.v_dq_outliers
                            WHERE periodo = %s AND status != 'ok'
                            """,
                            (p.to_int(), log.log_id, p.to_int()),
                        )
                        click.echo(f"  Check 2 (outliers):    {cur.rowcount} anomalías")

                    # --- Check 3: suma_subcuentas ---
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            INSERT INTO admin.data_quality_checks
                                (periodo, nomb_correg, check_type, cuenta_codigo,
                                 carga_log_id, status, expected_value, actual_value,
                                 delta_abs, delta_pct, payload)
                            SELECT
                                %s, nomb_correg, 'suma_subcuentas', cuenta_codigo,
                                %s, status, expected_value, actual_value,
                                delta_abs, delta_pct, '{}'::jsonb
                            FROM marts.v_dq_subcuentas
                            WHERE periodo = %s AND status != 'ok'
                            """,
                            (p.to_int(), log.log_id, p.to_int()),
                        )
                        click.echo(f"  Check 3 (subcuentas):  {cur.rowcount} anomalías")

                    # --- Auto-resolve de anomalias stale (issue #43) ---
                    # Cualquier check previo (carga_log_id != log_id actual) que ya no
                    # se reproduce en esta corrida significa que el re-ingest corrigio
                    # el problema. Se marca como resuelto en lugar de borrar, para
                    # preservar trazabilidad historica.
                    #   - auto_resolved   : la anomalia desaparecio (mismo key no esta
                    #                       en el run actual).
                    #   - auto_superseded : la anomalia sigue existiendo pero hay un
                    #                       row mas reciente en esta corrida.
                    n_auto_resolved = 0
                    n_auto_superseded = 0
                    review_notes_msg = (
                        f"Run carga_log_id={log.log_id} refresco el periodo. "
                        "Anomalia previa ya no aplica o fue reemplazada."
                    )
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            UPDATE admin.data_quality_checks AS prev
                               SET reviewed_at   = now(),
                                   reviewed_by   = 'system:quality-check',
                                   review_action = CASE WHEN EXISTS (
                                       SELECT 1
                                         FROM admin.data_quality_checks AS run
                                        WHERE run.carga_log_id = %s
                                          AND run.periodo      = prev.periodo
                                          AND run.nomb_correg  = prev.nomb_correg
                                          AND run.check_type   = prev.check_type
                                          AND COALESCE(run.cuenta_codigo, '') =
                                              COALESCE(prev.cuenta_codigo, '')
                                   ) THEN 'auto_superseded'
                                     ELSE 'auto_resolved'
                                   END,
                                   review_notes  = %s
                             WHERE prev.periodo       = %s
                               AND prev.reviewed_at  IS NULL
                               AND prev.carga_log_id IS DISTINCT FROM %s
                             RETURNING review_action
                            """,
                            (log.log_id, review_notes_msg, p.to_int(), log.log_id),
                        )
                        for (action,) in await cur.fetchall():
                            if action == "auto_resolved":
                                n_auto_resolved += 1
                            elif action == "auto_superseded":
                                n_auto_superseded += 1
                        if n_auto_resolved or n_auto_superseded:
                            click.echo(
                                f"  Auto-resolve: {n_auto_resolved} resueltas, "
                                f"{n_auto_superseded} reemplazadas (issue #43)"
                            )

                    # Counts finales
                    async with conn.cursor() as cur:
                        await cur.execute(
                            """
                            SELECT status, count(*)
                            FROM admin.data_quality_checks
                            WHERE periodo = %s AND carga_log_id = %s
                            GROUP BY status
                            """,
                            (p.to_int(), log.log_id),
                        )
                        for row in await cur.fetchall():
                            if row[0] == "warning":
                                n_warning = row[1]
                            elif row[0] == "critical":
                                n_critical = row[1]
                            else:
                                n_ok = row[1]

                    await conn.commit()

                log.rows_inserted = n_warning + n_critical
                log.metadata["warning_count"] = n_warning
                log.metadata["critical_count"] = n_critical
                log.metadata["ok_count"] = n_ok
                log.metadata["auto_resolved_count"] = n_auto_resolved
                log.metadata["auto_superseded_count"] = n_auto_superseded

                click.echo("")
                click.echo(
                    f"# Quality check periodo {periodo}: "
                    f"{n_warning} warning, {n_critical} critical."
                )
                if n_critical > 0:
                    click.echo(
                        "# Revisa: SELECT * FROM admin.data_quality_checks "
                        f"WHERE periodo={p.to_int()} AND status='critical' "
                        "AND reviewed_at IS NULL;"
                    )
        finally:
            await close_pool()

    asyncio.run(_run())


@main.group("sbs")
def sbs_group() -> None:
    """Comandos de sincronizacion con la SBS (cola de jobs + cron)."""


@sbs_group.command("work-jobs")
@click.option("--max-jobs", type=int, default=5, help="Numero maximo de jobs a procesar.")
def sbs_work_jobs(max_jobs: int) -> None:
    """Procesa jobs pendientes en admin.sync_jobs.

    Cron mensual recomendado en EasyPanel:
        0 3 25 * *  aibenchef sbs work-jobs

    Tambien lo dispara el dashboard /admin/archivos via boton 'Sincronizar SBS'.
    Por cada job:
      1. status -> 'running'
      2. ejecuta scrape para el rango periodos+topicos+grupos
      3. ejecuta storage scan (registra + actualiza tamanio/formato/status)
      4. ejecuta import all-monthly --periodo X (descargado -> procesado)
         para cada periodo del rango. Fix de issue #126.
      5. status -> 'completed' con metricas, o 'failed' con error_mensaje
    """
    import subprocess
    from datetime import datetime

    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    def _update(conn, job_id: int, **fields):
        cols = ", ".join(f"{k} = %s" for k in fields)
        vals = [*list(fields.values()), job_id]
        with conn.cursor() as cur:
            cur.execute(f"UPDATE admin.sync_jobs SET {cols} WHERE id = %s", vals)
        conn.commit()

    procesados = 0
    with psycopg.connect(url, connect_timeout=10) as conn:
        for _ in range(max_jobs):
            # Tomar el job pending mas antiguo. force_redownload (V135) permite
            # forzar re-baja aunque el archivo exista en storage — clave para
            # recuperarse de descargas SBS truncadas cacheadas.
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, periodo_desde, periodo_hasta, topicos, grupos, "
                    "       COALESCE(force_redownload, false) "
                    "FROM admin.sync_jobs WHERE status='pending' "
                    "ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED"
                )
                row = cur.fetchone()
            if not row:
                click.echo(f"# No hay jobs pendientes (procesados={procesados})")
                break

            job_id, desde, hasta, topicos, grupos, force_redownload = row
            click.echo(
                f"# Procesando job {job_id}: {desde}-{hasta} topicos={topicos} "
                f"grupos={grupos} force={force_redownload}"
            )
            _update(conn, job_id, status="running", started_at=datetime.utcnow())

            log_lines: list[str] = []
            ok = True
            try:
                # Ejecutar scrape (sin --topico -> todos)
                cmd = ["aibenchef", "scrape", "--desde", str(desde), "--hasta", str(hasta)]
                if force_redownload:
                    cmd.append("--force")
                if topicos:
                    for t in topicos:
                        cmd_t = [*cmd, "--topico", t]
                        log_lines.append(f"$ {' '.join(cmd_t)}")
                        r = subprocess.run(cmd_t, capture_output=True, text=True, timeout=1800)
                        log_lines.append(r.stdout[-500:] if r.stdout else "")
                        if r.returncode != 0:
                            log_lines.append(f"ERROR rc={r.returncode}: {r.stderr[-500:]}")
                            ok = False
                else:
                    log_lines.append(f"$ {' '.join(cmd)}")
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
                    log_lines.append(r.stdout[-500:] if r.stdout else "")
                    if r.returncode != 0:
                        log_lines.append(f"ERROR rc={r.returncode}: {r.stderr[-500:]}")
                        ok = False

                # Storage scan (registra archivos + actualiza md5 + status)
                log_lines.append("$ aibenchef storage scan --root ./local-data/raw")
                r = subprocess.run(
                    ["aibenchef", "storage", "scan", "--root", "./local-data/raw"],
                    capture_output=True,
                    text=True,
                    timeout=1800,
                )
                log_lines.append(r.stdout[-500:] if r.stdout else "")
                if r.returncode != 0:
                    log_lines.append(f"ERROR storage-scan rc={r.returncode}: {r.stderr[-500:]}")
                    ok = False

                # Import all-monthly por cada periodo del rango (fix #126).
                # Sin esto, los archivos quedan en status='descargado' eterno y
                # nunca llegan a marts/dashboards. Idempotente: ON CONFLICT en
                # las tablas raw + audit trail actualiza status='procesado'.
                any_imported = False
                if ok:
                    for p in range(desde, hasta + 1):
                        # Saltar gaps de mes (13, 14, etc) sin romper si desde/hasta
                        # son YYYYMM contiguos del mismo anio.
                        if (p % 100) < 1 or (p % 100) > 12:
                            continue
                        cmd_imp = ["aibenchef", "import", "all-monthly", "--periodo", str(p)]
                        log_lines.append(f"$ {' '.join(cmd_imp)}")
                        r = subprocess.run(cmd_imp, capture_output=True, text=True, timeout=3600)
                        log_lines.append(r.stdout[-500:] if r.stdout else "")
                        if r.returncode != 0:
                            log_lines.append(
                                f"ERROR all-monthly periodo={p} rc={r.returncode}: "
                                f"{r.stderr[-500:]}"
                            )
                            ok = False
                        elif "rows_insertadas=" in (r.stdout or "") and (
                            "rows_insertadas=0" not in (r.stdout or "")
                        ):
                            any_imported = True

                # Refresh de TODAS las derivadas (fix #126 fase 3 + V134).
                # Por cada periodo importado: refresh-derived orquesta
                # dw.recalcular_microfinancieras(p) + refresh_kpis_anuales +
                # refresh_all_marts. Sin esto, el dashboard tiene celdas vacias
                # (Cartera MYPE/Total fue el primer sintoma — bug raiz issue #134).
                # Es lento (mv_eeff_balance_ancho tarda 15+ min) — timeout 2h.
                # Failure NO marca el job como failed: data ya en raw, retry OK.
                if ok and any_imported:
                    for p in range(desde, hasta + 1):
                        if (p % 100) < 1 or (p % 100) > 12:
                            continue
                        cmd_refresh = [
                            "aibenchef",
                            "pipeline",
                            "refresh-derived",
                            "--periodo",
                            str(p),
                            "--triggered-by",
                            f"sync_job:{job_id}",
                        ]
                        log_lines.append(f"$ {' '.join(cmd_refresh)}")
                        r = subprocess.run(
                            cmd_refresh, capture_output=True, text=True, timeout=7200
                        )
                        log_lines.append(r.stdout[-800:] if r.stdout else "")
                        if r.returncode != 0:
                            log_lines.append(
                                f"WARN refresh-derived periodo={p} rc={r.returncode}: "
                                f"{r.stderr[-500:]}"
                            )

                        # Post-refresh (V138): correr quality-check para poblar
                        # admin.data_quality_checks y dejar la senal disponible
                        # en /admin/data-quality. NO afecta el status del job:
                        # es informativo, un fallo de quality-check no aborta.
                        cmd_qc = [
                            "aibenchef",
                            "pipeline",
                            "quality-check",
                            "--periodo",
                            str(p),
                            "--triggered-by",
                            f"sync_job:{job_id}",
                        ]
                        log_lines.append(f"$ {' '.join(cmd_qc)}")
                        r_qc = subprocess.run(cmd_qc, capture_output=True, text=True, timeout=1800)
                        log_lines.append(r_qc.stdout[-500:] if r_qc.stdout else "")
                        if r_qc.returncode != 0:
                            log_lines.append(
                                f"WARN quality-check periodo={p} rc={r_qc.returncode}: "
                                f"{r_qc.stderr[-500:]}"
                            )

                if ok:
                    _update(
                        conn,
                        job_id,
                        status="completed",
                        completed_at=datetime.utcnow(),
                        log_text="\n".join(log_lines)[:8000],
                    )
                    procesados += 1
                    click.echo(f"  job {job_id} OK")
                else:
                    _update(
                        conn,
                        job_id,
                        status="failed",
                        completed_at=datetime.utcnow(),
                        log_text="\n".join(log_lines)[:8000],
                        error_mensaje="Algun scrape fallo (ver log)",
                    )
                    click.echo(f"  job {job_id} FAILED")
            except Exception as e:
                log_lines.append(f"EXCEPTION: {e}")
                _update(
                    conn,
                    job_id,
                    status="failed",
                    completed_at=datetime.utcnow(),
                    log_text="\n".join(log_lines)[:8000],
                    error_mensaje=str(e)[:500],
                )
                click.echo(f"  job {job_id} EXCEPTION: {e}")

    click.echo(f"# Terminado: {procesados} jobs procesados")


def _sliding_window_periodos(anio_actual: int, mes_actual: int, months_back: int) -> list[int]:
    """Devuelve los ultimos `months_back` periodos YYYYMM (incluyendo mes anterior, NO el actual).

    Args:
        anio_actual: anio de hoy (1-9999).
        mes_actual: mes de hoy (1-12).
        months_back: cuantos meses atras incluir. Debe ser >= 1.

    Returns:
        Lista descendente de periodos YYYYMM. Para (2026, 6, 3) -> [202605, 202604, 202603].
        Maneja correctamente cruce de anio: (2026, 1, 3) -> [202512, 202511, 202510].
    """
    out: list[int] = []
    for i in range(1, months_back + 1):
        # mes_actual=1..12 -> base 0..11. Restamos i meses y dividimos.
        total = anio_actual * 12 + (mes_actual - 1) - i
        anio, mes_base = divmod(total, 12)
        out.append(anio * 100 + (mes_base + 1))
    return out


@sbs_group.command("queue-monthly")
@click.option(
    "--months-back",
    type=int,
    default=3,
    show_default=True,
    help=(
        "Cuantos meses atras encolar (ventana deslizante). SBS publica con retraso "
        "variable de 30-45 dias — un solo mes deja gaps cuando publican tarde."
    ),
)
@click.option(
    "--retry-no-publicado-days",
    type=int,
    default=90,
    show_default=True,
    help=(
        "Re-encolar periodos cuyos archivos no_publicado_sbs fueron registrados hace "
        "menos de N dias. SBS a veces publica con 2-3 meses de retraso (issue #126)."
    ),
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Listar periodos candidatos sin insertar jobs.",
)
def sbs_queue_monthly(
    months_back: int,
    retry_no_publicado_days: int,
    dry_run: bool,
) -> None:
    """Encola jobs 'cron' para sincronizar SBS — ventana deslizante + re-intentos.

    Estrategia (refs #126):

    1. Ventana deslizante: encola los ultimos `--months-back` meses (default 3).
       SBS no publica todo el mes el dia 25 — hay archivos que aparecen hasta
       45 dias despues. Re-procesarlos cada cron evita perderlos.

    2. Re-intento no_publicado_sbs: busca periodos con archivos en estado
       `no_publicado_sbs` registrados hace < `--retry-no-publicado-days` dias.
       Si SBS publica tardiamente, el cron los volvera a tomar.

    3. Idempotente: si ya existe un job pending/running para un periodo, no
       lo duplica (evita 3 jobs/dia del mismo periodo desde cron 3x/dia).

    Recomendado en cron (3x al dia):
        0 11,19,3 * * *  aibenchef sbs queue-monthly && aibenchef sbs work-jobs
    """
    from datetime import datetime

    import psycopg

    if months_back < 1:
        raise click.UsageError("--months-back debe ser >= 1")
    if retry_no_publicado_days < 0:
        raise click.UsageError("--retry-no-publicado-days debe ser >= 0")

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    now = datetime.now()

    # 1. Ventana deslizante de los ultimos N meses.
    sliding = _sliding_window_periodos(now.year, now.month, months_back)
    candidatos: set[int] = set(sliding)

    # 2. Re-intentar periodos con no_publicado_sbs recientes (publicacion tardia).
    retry_periodos: list[int] = []
    if retry_no_publicado_days > 0:
        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT periodo
                FROM raw.archivos_descargados
                WHERE status = 'no_publicado_sbs'
                  AND actualizado_en > NOW() - (%s || ' days')::interval
                ORDER BY periodo DESC
                """,
                (retry_no_publicado_days,),
            )
            retry_periodos = [row[0] for row in cur.fetchall()]
    candidatos.update(retry_periodos)

    # 3. Stale no_publicado_sbs (V157) — archivos que ya excedieron 1.5x el
    # lag esperado. Estos son candidatos DE ALTA PRIORIDAD porque suelen
    # ser sintoma de bug del downloader (HTML basura guardado como .xls) o
    # publicacion tardia real. La vista admin.v_no_publicados_stale ya
    # aplica el filtro de threshold.
    stale_periodos: list[int] = []
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                "SELECT DISTINCT periodo FROM admin.v_no_publicados_stale ORDER BY periodo DESC"
            )
            stale_periodos = [row[0] for row in cur.fetchall()]
        except psycopg.errors.UndefinedTable:
            # Vista no existe aun (migracion V157 pendiente) — skip silenciosamente.
            pass
    candidatos.update(stale_periodos)

    click.echo(
        f"# Candidatos: {len(candidatos)} "
        f"(sliding={sliding}, retry={retry_periodos}, stale={stale_periodos})"
    )

    if dry_run:
        click.echo("# DRY-RUN: no se insertara nada.")
        for periodo in sorted(candidatos, reverse=True):
            click.echo(f"  ~ periodo {periodo}")
        return

    # 3. Insert idempotente: solo si no hay pending/running para ese periodo.
    encolados: list[tuple[int, int]] = []
    skipeados: list[int] = []
    insert_sql = """
        INSERT INTO admin.sync_jobs (periodo_desde, periodo_hasta, triggered_by)
        SELECT %s, %s, 'cron'
        WHERE NOT EXISTS (
            SELECT 1 FROM admin.sync_jobs
            WHERE status IN ('pending', 'running')
              AND periodo_desde = %s
              AND periodo_hasta = %s
        )
        RETURNING id
    """
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for periodo in sorted(candidatos, reverse=True):
            cur.execute(insert_sql, (periodo, periodo, periodo, periodo))
            row = cur.fetchone()
            if row is not None:
                encolados.append((row[0], periodo))
            else:
                skipeados.append(periodo)
        conn.commit()

    for job_id, periodo in encolados:
        click.echo(f"  + encolado job {job_id} para periodo {periodo}")
    for periodo in skipeados:
        click.echo(f"  = skip periodo {periodo} (ya hay pending/running)")
    click.echo(f"# Encolados: {len(encolados)}, skipeados: {len(skipeados)}")


@sbs_group.command("recheck-stale-no-publicados")
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Listar archivos stale + acciones sin ejecutar cambios.",
)
@click.option(
    "--delete-local-files",
    is_flag=True,
    default=True,
    show_default=True,
    help=(
        "Borrar el .xls local corrupto (HTML basura) antes de re-encolar. "
        "Sin este flag, el downloader lo detecta ahora via magic-byte check "
        "e igual lo re-descarga, pero borrar explicito es mas transparente."
    ),
)
def sbs_recheck_stale_no_publicados(dry_run: bool, delete_local_files: bool) -> None:
    """Trigger MANUAL: re-cheque archivos SBS marcados stale y encola jobs.

    Casos de uso:

    - Un archivo lleva 40+ dias marcado 'no_publicado_sbs' pero SBS ya lo
      publico (bug del downloader que guardo HTML como .xls + skip_if_exists
      lo bloqueaba). Este comando invalida el archivo local y encola un
      sync_job — el proximo work-jobs lo re-descarga y (gracias al magic-byte
      check nuevo) lo procesa correctamente.

    - Alerta manual del /dashboard/admin/data-quality tras la migracion V157
      (que ahora dispara critical cuando actualizado_en < fecha_esperada + lag*1.5).

    Flow:
      1. Lee admin.v_no_publicados_stale (V157 vista).
      2. Para cada archivo stale: borra el .xls local si existe.
      3. Encola sync_jobs por periodo (idempotente — no duplica pending).

    Recomendado desde el cron aibenchef-daily-sync.sh o manual tras una
    alerta de data-quality:

        aibenchef sbs recheck-stale-no-publicados
        aibenchef sbs work-jobs
    """
    from pathlib import Path

    import psycopg

    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")

    stale_rows: list[tuple[int, str, str, str, int]] = []
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT periodo, grupo, topico, path_local, dias_stale
                FROM admin.v_no_publicados_stale
                ORDER BY dias_stale DESC, periodo DESC
                """
            )
            stale_rows = list(cur.fetchall())
        except psycopg.errors.UndefinedTable as e:
            raise click.ClickException(
                "admin.v_no_publicados_stale no existe. Aplica la migracion V157 primero."
            ) from e

    if not stale_rows:
        click.echo("# Sin archivos stale — nada que hacer.")
        return

    click.echo(f"# Archivos stale detectados: {len(stale_rows)}")

    # 1. Invalidar archivos locales corruptos.
    n_borrados = 0
    n_no_existentes = 0
    if delete_local_files:
        for _periodo, _grupo, _topico, path_local, _dias in stale_rows:
            p = Path(path_local)
            if not p.exists():
                n_no_existentes += 1
                continue
            action = "borraria" if dry_run else "borrado"
            click.echo(f"  - {action}: {path_local}")
            if not dry_run:
                try:
                    p.unlink()
                    n_borrados += 1
                except OSError as e:
                    click.echo(f"    ! fallo al borrar: {e}", err=True)
        click.echo(f"# Locales borrados: {n_borrados}, no-existentes: {n_no_existentes}")

    # 2. Encolar sync_jobs por periodo (dedupe).
    periodos_stale = sorted({row[0] for row in stale_rows}, reverse=True)
    if dry_run:
        click.echo(f"# DRY-RUN: encolaria {len(periodos_stale)} periodos: {periodos_stale}")
        return

    encolados: list[tuple[int, int]] = []
    skipeados: list[int] = []
    insert_sql = """
        INSERT INTO admin.sync_jobs (periodo_desde, periodo_hasta, triggered_by)
        SELECT %s, %s, 'recheck-stale'
        WHERE NOT EXISTS (
            SELECT 1 FROM admin.sync_jobs
            WHERE status IN ('pending', 'running')
              AND periodo_desde = %s
              AND periodo_hasta = %s
        )
        RETURNING id
    """
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for periodo in periodos_stale:
            cur.execute(insert_sql, (periodo, periodo, periodo, periodo))
            row = cur.fetchone()
            if row is not None:
                encolados.append((row[0], periodo))
            else:
                skipeados.append(periodo)
        conn.commit()

    for job_id, periodo in encolados:
        click.echo(f"  + encolado job {job_id} para periodo {periodo}")
    for periodo in skipeados:
        click.echo(f"  = skip periodo {periodo} (ya hay pending/running)")
    click.echo(
        f"# Encolados: {len(encolados)}, skipeados: {len(skipeados)}. "
        f"Corre `aibenchef sbs work-jobs` para procesarlos."
    )


if __name__ == "__main__":
    main()
