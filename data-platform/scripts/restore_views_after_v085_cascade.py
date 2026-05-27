"""Restore views dropped por V085__fix_mv_eeff_dedup_empresa_sbs CASCADE.

Issue #8: V085 hizo `DROP MATERIALIZED VIEW marts.mv_eeff_balance_ancho CASCADE`
y se llevo por delante ~20 vistas dependientes (mora, cobertura, SMF, KPIs,
cartera_balance, castigos_12m, etc). Las migrations originales V063-V084
estan marcadas como aplicadas en public.schema_migrations, asi que
`aibenchef db migrate` no las re-ejecuta.

Este script re-aplica esas migrations manualmente en orden de dependencias.
Es idempotente (todas usan CREATE OR REPLACE VIEW).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import psycopg

from aibenchef_data.env import settings

# Orden de dependencias: las "base" antes que las que las consumen.
# V082 -> v_venta_cartera_mes, v_venta_cartera_mes_historica
# V083 -> v_cartera_balance_entidad, v_castigos_12m_*, v_venta_cartera_12m_*, v_mora_global_*
# V084 -> v_microfinancieras_periodo, v_participacion_smf_*
# V073 -> v_kpis_anuales_*
# V081 -> v_castigos_12m_universo_colocaciones (puede sobrescribir V083)
# V065 -> v_cobertura_car_*
# V070 -> versiones historicas (cobertura_car_historica)
MIGRATIONS_IN_ORDER = [
    "V063__participacion_smf_colocaciones_depositos.sql",
    "V064__mora_global_y_cobertura.sql",
    "V065__cobertura_car_y_mora_vc.sql",
    "V067__kpis_anuales_eficiencia_rentabilidad.sql",
    "V069__vistas_historicas_sin_canonizar.sql",
    "V070__vistas_historicas_nombre_vigente.sql",
    "V072__fix_kpis_anuales_canonizar.sql",
    "V073__kpis_anuales_sql_puro.sql",
    "V081__castigos_12m_universo_colocaciones.sql",
    "V082__mora_global_historica_con_venta_cartera.sql",
    "V083__mora_global_desde_balance.sql",
    "V084__mype_y_smf_denominador_balance.sql",
]


def main() -> None:
    db_url = settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    migrations_dir = (
        Path(__file__).resolve().parent.parent.parent / "infrastructure" / "postgres" / "migrations"
    )

    print("# Restaurando vistas droppeadas por V085 CASCADE")
    print(f"# Migrations dir: {migrations_dir}")
    print(f"# DB: {db_url.split('@')[1][:50]}...")
    print()

    with psycopg.connect(db_url, autocommit=False) as conn:
        for fname in MIGRATIONS_IN_ORDER:
            path = migrations_dir / fname
            if not path.exists():
                print(f"  [SKIP] {fname} no existe en disk")
                continue
            sql = path.read_text(encoding="utf-8")
            print(f"  [RUN]  {fname}")
            try:
                with conn.cursor() as cur:
                    cur.execute(sql)
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"         FAIL: {type(e).__name__}: {e}")
                # Continuar con las demas
                continue

    # Verificar las 10 vistas finales que el frontend necesita
    print()
    print("# Verificacion final:")
    target_views = [
        "v_participacion_smf_colocaciones",
        "v_participacion_smf_coloc_historica",
        "v_participacion_smf_dep_historica",
        "v_microfinancieras_historica",
        "v_mora_global_por_entidad",
        "v_mora_global_historica",
        "v_cobertura_car_por_entidad",
        "v_cobertura_car_historica",
        "v_kpis_anuales_entidad",
        "v_kpis_anuales_historica",
    ]
    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT viewname FROM pg_views WHERE schemaname='marts'")
        exist = {r[0] for r in cur.fetchall()}
        for v in target_views:
            print(f"  {'[OK]   ' if v in exist else '[MISS] '} marts.{v}")


if __name__ == "__main__":
    main()
