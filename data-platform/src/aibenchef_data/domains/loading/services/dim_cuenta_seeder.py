"""DimCuentaSeeder — UPSERT del plan de cuentas en dw.dim_cuenta.

Lee los seeds JSON generados por `aibenchef catalog extract-canonical` y
los aplica a `dw.dim_cuenta` (idempotente).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path

import psycopg

from aibenchef_data.domains.shared import get_logger

log = get_logger(__name__)


class DimCuentaSeeder:
    def __init__(self, conn: psycopg.AsyncConnection) -> None:
        self._conn = conn

    async def seed_from_json(self, seeds_dir: Path) -> int:
        """Carga cuentas_balance.json + cuentas_resultados.json a dw.dim_cuenta.

        Devuelve la cantidad de filas afectadas (insertadas + actualizadas).
        Cada categoria se ejecuta en su propia transaccion para aislar fallas.
        """
        total = 0
        for category in ("balance", "resultados"):
            path = seeds_dir / f"cuentas_{category}.json"
            if not path.exists():
                log.warning(
                    "seed.skip_missing_file", category=category, path=str(path)
                )
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            try:
                n = await self._upsert_batch(data, category)
                await self._conn.commit()
                total += n
                log.info("seed.category_done", category=category, rows=n)
            except Exception:
                await self._conn.rollback()
                log.error("seed.category_failed", category=category)
                raise
        return total

    async def _upsert_batch(self, items: Iterable[dict], category: str) -> int:
        rows = []
        for it in items:
            tipo_estado = it.get("tipo_estado") or (
                "balance" if category == "balance" else "resultados"
            )
            rows.append(
                (
                    it["codigo"],
                    it["nombre"],
                    it["nivel"],
                    it.get("parent_codigo"),
                    it.get("orden", 0),
                    tipo_estado,
                    int(it.get("signo", 1)),
                )
            )

        if not rows:
            return 0

        sql = """
            INSERT INTO dw.dim_cuenta
                (codigo, nombre, nivel, parent_codigo, orden, tipo_estado, signo, topico)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, 'eeff')
            ON CONFLICT (codigo) DO UPDATE SET
                nombre        = EXCLUDED.nombre,
                nivel         = EXCLUDED.nivel,
                parent_codigo = EXCLUDED.parent_codigo,
                orden         = EXCLUDED.orden,
                tipo_estado   = EXCLUDED.tipo_estado,
                signo         = EXCLUDED.signo
        """
        async with self._conn.cursor() as cur:
            await cur.executemany(sql, rows)
        return len(rows)
