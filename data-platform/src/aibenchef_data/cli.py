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

    inserted = 0
    updated = 0
    skipped = 0

    with psycopg.connect(url, connect_timeout=10) as conn, conn.cursor() as cur:
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

            size = f.stat().st_size
            with open(f, "rb") as fh:
                md5 = hashlib.md5(fh.read()).hexdigest()
            try:
                fmt = detect_xls_format(f)
            except Exception:
                fmt = None

            # Reconstruir source_url
            url_sbs = f"{sbs_base}/{anio}/{meses_es[m.group('mes')]}/{archivo}"

            if dry_run:
                click.echo(f"  [dry] {rel}  size={size:,}B  fmt={fmt}")
                continue

            cur.execute(
                """
                INSERT INTO raw.archivos_descargados (
                    grupo, topico, periodo, anio, mes,
                    nombre_archivo, path_local, source_url,
                    tamanio_bytes, md5_hash, formato
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (path_local) DO UPDATE SET
                    tamanio_bytes  = EXCLUDED.tamanio_bytes,
                    md5_hash       = EXCLUDED.md5_hash,
                    formato        = EXCLUDED.formato,
                    actualizado_en = now()
                RETURNING (xmax = 0) AS inserted
                """,
                (
                    grupo,
                    topico,
                    periodo,
                    anio,
                    mes,
                    archivo,
                    str(f),
                    url_sbs,
                    size,
                    md5,
                    fmt,
                ),
            )
            row = cur.fetchone()
            if row and row[0]:
                inserted += 1
            else:
                updated += 1
        conn.commit()

    click.echo("")
    click.echo(f"# Insertados: {inserted}")
    click.echo(f"# Actualizados: {updated}")
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
    import time

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
    click.echo(f"  -> {len(succeeded)} OK, {len(failed)} fallidos.")
    for r in failed:
        click.echo(f"     FALLO {r.target.url}: {r.error_message}")
    return len(succeeded), len(failed)


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
                        result = await importer.import_file(f)
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
                        result = await importer.import_file(f)
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
                        result = await importer.import_file(f)
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
                        result = await importer.import_file(f)
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
                        result = await importer.import_file(f)
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
                        result = await importer.import_file(f)
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
                        result = await importer.import_file(f)
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


if __name__ == "__main__":
    main()
