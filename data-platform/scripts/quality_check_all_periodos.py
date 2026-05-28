"""Corre `aibenchef pipeline quality-check` para TODOS los periodos con data.

Util para validar coherencia tras un cambio mayor en cabecera/parser (V099,
V100, V101) o periodicamente como cron mensual.

Cada run del CLI ahora hace auto-resolve de anomalias previas que ya no
aplican (issue #43): los rows con `carga_log_id` de runs viejos se marcan
como `auto_resolved` (la anomalia desaparecio) o `auto_superseded` (la
anomalia sigue, pero hay un row nuevo). El Inspector solo muestra rows con
`reviewed_at IS NULL`, asi que el backlog se limpia naturalmente sin
intervencion manual.

Uso:
    uv run python scripts/quality_check_all_periodos.py [--from YYYYMM] [--to YYYYMM]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import psycopg

from aibenchef_data.env import settings


def list_periodos(min_periodo: int | None, max_periodo: int | None) -> list[int]:
    url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT periodo
              FROM raw.eeff_observacion
             WHERE periodo BETWEEN %s AND %s
             ORDER BY periodo
            """,
            (min_periodo or 200001, max_periodo or 209912),
        )
        return [r[0] for r in cur.fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="from_p", type=int, default=202501)
    parser.add_argument("--to", dest="to_p", type=int, default=None)
    args = parser.parse_args()

    periodos = list_periodos(args.from_p, args.to_p)
    print(f"# {len(periodos)} periodos a procesar: {periodos[0]}..{periodos[-1]}")
    print("")

    aibenchef_bin = Path(sys.executable).parent / "aibenchef"
    if not aibenchef_bin.exists():
        aibenchef_bin = "aibenchef"

    ok = 0
    failed = 0
    for p in periodos:
        cmd = [
            str(aibenchef_bin),
            "pipeline",
            "quality-check",
            "--periodo",
            str(p),
            "--triggered-by",
            "cli:bulk-validate",
        ]
        print(f"## periodo {p}")
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            print(f"  FAIL: {r.stderr[-500:]}")
            failed += 1
            continue
        # Mostrar solo la linea de TOTAL
        for line in r.stdout.splitlines():
            if (
                "Quality check periodo" in line
                or "anomalías" in line.lower()
                or "anomalias" in line.lower()
            ):
                print(f"  {line.strip()}")
        ok += 1

    print("")
    print(f"# DONE — {ok} OK, {failed} FAILED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
