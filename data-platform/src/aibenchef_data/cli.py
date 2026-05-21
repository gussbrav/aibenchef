"""CLI principal de Aibenchef data platform.

Ejemplos:
    aibenchef --help
    aibenchef catalog list-entidades
    aibenchef catalog list-entidades --grupo cmac
    aibenchef ingest --periodo 202404
    aibenchef ingest --periodo 202404 --grupo cmac --topico eeff
"""

from __future__ import annotations

import asyncio

import click

from aibenchef_data.domains.catalog import EntidadesCatalog, Grupo, Periodo, Topico
from aibenchef_data.domains.shared import configure_logging, get_logger


@click.group()
@click.version_option()
def main() -> None:
    """Aibenchef data platform CLI."""
    configure_logging()


# ============================================================================
# Comandos catalog
# ============================================================================


@main.group()
def catalog() -> None:
    """Comandos del catalogo (entidades, topicos, periodos)."""


@catalog.command("list-entidades")
@click.option(
    "--grupo",
    type=click.Choice([g.value for g in Grupo], case_sensitive=False),
    default=None,
    help="Filtrar por grupo",
)
@click.option("--solo-microfinanzas", is_flag=True, default=False)
@click.option("--solo-activas", is_flag=True, default=True)
def catalog_list_entidades(
    grupo: str | None,
    solo_microfinanzas: bool,
    solo_activas: bool,
) -> None:
    """Listar entidades conocidas del catalogo SBS."""
    cat = EntidadesCatalog.default()
    g = Grupo(grupo) if grupo else None
    entidades = cat.list(grupo=g, solo_activas=solo_activas)
    if solo_microfinanzas:
        entidades = [e for e in entidades if e.es_microfinanciera]

    if not entidades:
        click.echo("(sin entidades — verificar seed seeds/entidades.json)")
        return

    click.echo(f"{'CODIGO':<8} {'GRUPO':<18} NOMBRE")
    click.echo("-" * 80)
    for e in entidades:
        flag = "*" if e.es_microfinanciera else " "
        click.echo(f"{e.codigo_sbs:<8} {e.grupo.value:<18} {flag} {e.nombre_corto or e.nombre}")
    click.echo(f"\nTotal: {len(entidades)} entidades")


@catalog.command("show-topicos")
def catalog_show_topicos() -> None:
    """Listar tópicos disponibles."""
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
    click.echo(f"SBS suffix:   {p.sbs_suffix}  (como aparece en filenames)")
    click.echo(f"Cierre:       {p.cierre}")
    click.echo(f"Anterior:     {p.previous()}")
    click.echo(f"Siguiente:    {p.next()}")


# ============================================================================
# Comando ingest (stub — implementacion completa en sub-fases 1.3..1.5)
# ============================================================================


@main.command()
@click.option(
    "--periodo",
    type=str,
    required=False,
    default=None,
    help="Periodo YYYYMM. Vacio = mes anterior al actual.",
)
@click.option(
    "--grupo",
    type=click.Choice([g.value for g in Grupo], case_sensitive=False),
    default=None,
    help="Filtrar por grupo. Vacio = todos.",
)
@click.option(
    "--topico",
    type=click.Choice([t.value for t in Topico], case_sensitive=False),
    default=None,
    help="Filtrar por topico. Vacio = todos.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Mostrar que se haria sin descargar nada.",
)
def ingest(
    periodo: str | None,
    grupo: str | None,
    topico: str | None,
    dry_run: bool,
) -> None:
    """Ejecutar la ingesta: scrape -> parse -> load -> dbt."""
    p = Periodo.from_yyyymm(periodo) if periodo else Periodo.previous_month()
    g = Grupo(grupo) if grupo else None
    t = Topico(topico) if topico else None

    log = get_logger(__name__)
    log.info(
        "ingest.plan",
        periodo=str(p),
        grupo=g.value if g else "all",
        topico=t.value if t else "all",
        dry_run=dry_run,
    )

    asyncio.run(_ingest_stub(periodo=p, grupo=g, topico=t, dry_run=dry_run))


async def _ingest_stub(
    *,
    periodo: Periodo,
    grupo: Grupo | None,
    topico: Topico | None,
    dry_run: bool,
) -> None:
    """Placeholder. Se completa en sub-fases 1.3 (scraping), 1.4 (parsing), 1.5 (loading)."""
    log = get_logger(__name__)
    cat = EntidadesCatalog.default()
    entidades = cat.list(grupo=grupo)
    topicos = [topico] if topico else list(Topico)
    log.info(
        "ingest.estimate",
        periodo=str(periodo),
        entidades=len(entidades),
        topicos=len(topicos),
        archivos_a_descargar=len(entidades) * len(topicos),
        status="not_implemented_yet",
    )


if __name__ == "__main__":
    main()
