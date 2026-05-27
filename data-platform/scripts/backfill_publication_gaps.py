"""Backfill de gaps de publicacion SBS — issue #3.

Detecta huecos en raw.archivos_descargados (meses faltantes entre meses
procesados) y verifica con un GET al URL SBS si el archivo realmente no
existe. Si SBS confirma con 404 o HTML pequeño, registra el periodo como
`status='no_publicado_sbs'` para que el dashboard lo diferencie del gap
silencioso actual.

Uso:
    uv run python scripts/backfill_publication_gaps.py [--topico TOPICO] [--dry-run]

Sin argumentos itera por todos los toopicos y verifica cualquier gap detectado
entre el min(periodo) y max(periodo) procesados para ese (grupo, topico).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import httpx
import psycopg

from aibenchef_data.domains.catalog import Grupo, Periodo, SbsUrlBuilder, Topico
from aibenchef_data.env import settings

_MIN_VALID_SIZE_BYTES = 1024


def _next_periodo(yyyymm: int) -> int:
    anio, mes = divmod(yyyymm, 100)
    mes += 1
    if mes == 13:
        mes = 1
        anio += 1
    return anio * 100 + mes


def _detect_gaps_for_grupo_topico(conn: psycopg.Connection, grupo: str, topico: str) -> list[int]:
    """Devuelve periodos faltantes entre min y max ya registrados para (grupo, topico)."""
    folder_map = {
        "BANCOS": "banca_multiple",
        "FINANCIERAS": "financiera",
        "CMAC": "cmac",
        "CRAC": "crac",
        "EDPYMES": "edpyme",
    }
    folder = folder_map[grupo]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT periodo
            FROM raw.archivos_descargados
            WHERE topico = %s AND path_local LIKE %s
            ORDER BY periodo
            """,
            (topico, f"%{folder}%"),
        )
        existing = [r[0] for r in cur.fetchall()]
    if not existing:
        return []
    gaps: list[int] = []
    cur_p = existing[0]
    existing_set = set(existing)
    while cur_p <= existing[-1]:
        if cur_p not in existing_set:
            gaps.append(cur_p)
        cur_p = _next_periodo(cur_p)
    return gaps


async def _check_url(client: httpx.AsyncClient, url: str) -> tuple[str, int, int]:
    """Hace HEAD/GET al URL SBS. Devuelve (resultado, http_status, size).

    resultado: 'no_publicado' | 'ok' | 'error'
    """
    try:
        resp = await client.get(url, follow_redirects=True, timeout=20.0)
        size = len(resp.content)
        if resp.status_code == 404:
            return ("no_publicado", 404, 0)
        if resp.status_code == 200 and size < _MIN_VALID_SIZE_BYTES:
            return ("no_publicado", 200, size)
        if resp.status_code == 200:
            return ("ok", 200, size)
        return ("error", resp.status_code, size)
    except (httpx.TransportError, httpx.TimeoutException):
        return ("error", 0, 0)


async def _backfill_one(
    grupo: Grupo,
    topico: Topico,
    gaps: list[int],
    client: httpx.AsyncClient,
    db_url: str,
    dry_run: bool,
) -> tuple[int, int]:
    """Verifica cada gap contra SBS. Devuelve (no_publicados, ok_recientes)."""
    if not gaps:
        return (0, 0)
    no_pub = 0
    ok_rec = 0
    for periodo_int in gaps:
        anio, mes = divmod(periodo_int, 100)
        periodo = Periodo(anio, mes)
        try:
            ref = SbsUrlBuilder.build(grupo, topico, periodo)
        except Exception:
            continue
        result, http_status, size = await _check_url(client, ref.url())
        print(
            f"  {grupo.value}/{topico.value}/{periodo_int}: {result} (HTTP {http_status}, {size}B)"
        )
        if result == "no_publicado" and not dry_run:
            with psycopg.connect(db_url) as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO raw.archivos_descargados (
                        grupo, topico, periodo, anio, mes, nombre_archivo, path_local,
                        source_url, tamanio_bytes, formato, status, error_mensaje,
                        descargado_en, actualizado_en
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, 'no_publicado', 'no_publicado_sbs',
                        %s, NOW(), NOW()
                    )
                    ON CONFLICT (path_local) DO UPDATE
                    SET status = 'no_publicado_sbs',
                        error_mensaje = EXCLUDED.error_mensaje,
                        actualizado_en = NOW()
                    WHERE raw.archivos_descargados.status NOT IN ('procesado', 'descargado')
                    """,
                    (
                        grupo.value,
                        topico.value,
                        periodo_int,
                        anio,
                        mes,
                        ref.filename,
                        str(ref.url()),
                        ref.url(),
                        size,
                        f"backfill: SBS no publico (HTTP {http_status}, {size}B)",
                    ),
                )
                conn.commit()
            no_pub += 1
        elif result == "ok":
            ok_rec += 1
    return (no_pub, ok_rec)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topico", default=None, help="Topico a verificar. Omite = todos.")
    parser.add_argument("--grupo", default=None, help="Grupo a verificar. Omite = todos.")
    parser.add_argument("--dry-run", action="store_true", help="Solo reportar, no insertar.")
    args = parser.parse_args()

    db_url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    topicos = [Topico(args.topico)] if args.topico else list(Topico)
    grupos = [Grupo(args.grupo)] if args.grupo else list(Grupo)

    print(f"# Modo: {'DRY-RUN' if args.dry_run else 'APLICAR'}")
    print(f"# Grupos: {[g.value for g in grupos]}")
    print(f"# Topicos: {[t.value for t in topicos]}")

    async with httpx.AsyncClient() as client:
        with psycopg.connect(db_url) as conn:
            tipo_to_grupo = {
                "BANCOS": Grupo.BANCA_MULTIPLE,
                "FINANCIERAS": Grupo.FINANCIERA,
                "CMAC": Grupo.CMAC,
                "CRAC": Grupo.CRAC,
                "EDPYMES": Grupo.EDPYME,
            }
            for grupo_str, grupo_enum in tipo_to_grupo.items():
                if grupo_enum not in grupos:
                    continue
                for topico in topicos:
                    if not SbsUrlBuilder.is_published(grupo_enum, topico):
                        continue
                    gaps = _detect_gaps_for_grupo_topico(conn, grupo_str, topico.value)
                    if not gaps:
                        continue
                    print(f"\n=== {grupo_str} / {topico.value}: {len(gaps)} gaps ===")
                    no_pub, ok_rec = await _backfill_one(
                        grupo_enum, topico, gaps, client, db_url, args.dry_run
                    )
                    print(f"  -> {no_pub} marcados no_publicado_sbs, {ok_rec} todavia disponibles")


if __name__ == "__main__":
    asyncio.run(main())
