"""Genera V090__restore_views_after_v085_cascade.sql concatenando las
migrations afectadas por V085 CASCADE, ordenadas por dependencias.

Filtra `DROP VIEW IF EXISTS ... CASCADE` (que cause cadenas no deseadas
en CI) — todas las definitions usan CREATE OR REPLACE asi que el DROP
es innecesario para idempotencia.
"""

from __future__ import annotations

import re
from pathlib import Path

# Orden topologico de las migrations a re-aplicar.
MIGRATIONS = [
    "V065__cobertura_car_y_mora_vc.sql",
    "V067__kpis_anuales_eficiencia_rentabilidad.sql",
    "V069__vistas_historicas_sin_canonizar.sql",
    "V070__vistas_historicas_nombre_vigente.sql",
    "V073__kpis_anuales_sql_puro.sql",  # sobrescribe V067/V072
    "V082__mora_global_historica_con_venta_cartera.sql",
    "V083__mora_global_desde_balance.sql",  # sobrescribe V082 partes
    "V084__mype_y_smf_denominador_balance.sql",  # finaliza SMF
]


HEADER = """-- V090 — Restore vistas droppeadas por V085 CASCADE
--
-- ROOT CAUSE (issue #8):
-- V085__fix_mv_eeff_dedup_empresa_sbs.sql ejecuto
--   `DROP MATERIALIZED VIEW marts.mv_eeff_balance_ancho CASCADE`
-- para recrearla con el GROUP BY corregido (dedup empresa_sbs).
-- El CASCADE silenciosamente removio ~20 vistas dependientes:
--   v_cartera_balance_*, v_castigos_12m_*, v_venta_cartera_*,
--   v_mora_global_*, v_cobertura_car_*, v_participacion_smf_*,
--   v_microfinancieras_historica, v_kpis_anuales_*, etc.
--
-- En V085 solo se restauro manualmente mv_eeff_ratios. El resto, al ser
-- vistas normales en migrations ya aplicadas en public.schema_migrations,
-- nunca se re-aplicaron automaticamente.
--
-- Sintomas observados:
--   - Panel /dashboard/informe muestra "6 de 6 entidades sin data en MVs"
--   - 10 vistas marts.v_* referenciadas en frontend no existen
--   - SQL silencioso retorna 0 filas (PostgreSQL no falla al consultar
--     una vista inexistente desde un CTE join lateral)
--
-- FIX:
-- Restaurar el dependency graph aplicando idempotentemente las migrations
-- afectadas en orden topologico. Todas usan CREATE OR REPLACE VIEW, asi
-- que es seguro re-ejecutar.
--
-- Bloques (auto-generados desde las migrations originales, sin DROP):
{toc}

"""


def main() -> None:
    repo = Path(__file__).resolve().parent.parent.parent
    migs_dir = repo / "infrastructure" / "postgres" / "migrations"

    parts: list[str] = []
    toc: list[str] = []
    for fname in MIGRATIONS:
        path = migs_dir / fname
        text = path.read_text(encoding="utf-8")
        # CADA CREATE [OR REPLACE] VIEW va precedido por DROP IF EXISTS CASCADE
        # para forzar el schema correcto cuando la vista ya existe con columnas
        # distintas. Todo dropped en una transaccion V090 sera recreado mas adelante
        # en el mismo V090 (en orden topologico).
        text = re.sub(
            r"^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(marts\.\w+)\s+AS\b",
            lambda m: f"DROP VIEW IF EXISTS {m.group(1)} CASCADE;\nCREATE VIEW {m.group(1)} AS",
            text,
            flags=re.MULTILINE | re.IGNORECASE,
        )
        # CREATE MATERIALIZED VIEW: prepend DROP IF EXISTS CASCADE
        text = re.sub(
            r"^\s*CREATE\s+MATERIALIZED\s+VIEW\s+(marts\.\w+)\s+AS\b",
            lambda m: (
                f"DROP MATERIALIZED VIEW IF EXISTS {m.group(1)} CASCADE;\n"
                f"CREATE MATERIALIZED VIEW {m.group(1)} AS"
            ),
            text,
            flags=re.MULTILINE | re.IGNORECASE,
        )

        parts.append("\n-- =============================================================\n")
        parts.append(f"-- {fname}\n")
        parts.append("-- =============================================================\n")
        parts.append(text)
        toc.append(f"--   * {fname}")

    # APPEND final: re-crear vistas que cayeron por CASCADE en cadenas posteriores
    # del propio V090 y no se recrearon en migrations subsiguientes.
    APPEND_FINAL = """

-- =============================================================
-- APPEND FINAL: vistas residuales caidas por CASCADE intra-V090
-- =============================================================

-- v_participacion_smf_dep_historica (V070 la crea, pero V084 dropea
-- v_microfinancieras_historica CASCADE y se la lleva).
DROP VIEW IF EXISTS marts.v_participacion_smf_dep_historica CASCADE;
CREATE VIEW marts.v_participacion_smf_dep_historica AS
WITH base AS (
    SELECT
        dep.periodo, dep.nomb_correg, dep.depositos_total,
        mfi.es_microfinanciera
    FROM marts.v_depositos_total_historica dep
    LEFT JOIN marts.v_microfinancieras_historica mfi
        ON mfi.periodo = dep.periodo AND mfi.nomb_correg = dep.nomb_correg
),
totales AS (
    SELECT periodo, SUM(depositos_total) AS total_smf FROM base
    WHERE COALESCE(es_microfinanciera, FALSE) = TRUE
    GROUP BY periodo
)
SELECT
    b.periodo, b.nomb_correg,
    COALESCE(b.es_microfinanciera, FALSE) AS es_smf,
    CASE WHEN COALESCE(b.es_microfinanciera, FALSE) AND t.total_smf > 0
         THEN ROUND((b.depositos_total / t.total_smf)::numeric, 6)
         ELSE 0 END AS pct_participacion_smf
FROM base b
LEFT JOIN totales t ON t.periodo = b.periodo;
"""
    out = HEADER.format(toc="\n".join(toc)) + "\n".join(parts) + APPEND_FINAL
    target = migs_dir / "V090__restore_views_after_v085_cascade.sql"
    target.write_text(out, encoding="utf-8", newline="\n")
    print(f"Wrote {target} ({len(out):,} bytes)")


if __name__ == "__main__":
    main()
