"""Generador de migraciones SQL para los marts EEFF wide-format.

Lee los seeds JSON (cuentas_balance.json + cuentas_resultados.json) y genera
las migraciones V009 + V010 que crean:
- marts.mv_eeff_balance_ancho (pivot wide de Balance)
- marts.mv_eeff_resultados_ancho (pivot wide de Resultados)

Una columna por cuenta canonica con nombre `cta_<codigo_sanitizado>`.
Ejemplo: cuenta (A1.1) Caja -> columna `cta_a1_1`.

Uso:
    cd data-platform
    uv run python scripts/generate_marts_sql.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SEEDS_DIR = Path(__file__).resolve().parents[1] / "seeds"
OUT_DIR = REPO_ROOT / "infrastructure" / "postgres" / "migrations"


def sanitize_codigo(codigo: str) -> str:
    """`A1.1` -> `a1_1`. `B.2.4` -> `b_2_4`."""
    return codigo.lower().replace(".", "_")


def column_name(codigo: str) -> str:
    return f"cta_{sanitize_codigo(codigo)}"


def safe_comment(text: str) -> str:
    """Sanitiza comentarios SQL (evita / o newlines en el texto)."""
    return re.sub(r"[\r\n]", " ", text).replace("/*", "/ *").replace("*/", "* /")


def build_view_sql(
    *,
    view_name: str,
    tipo_estado: str,
    cuentas: list[dict],
) -> str:
    """Construye el CREATE MATERIALIZED VIEW para un tipo de estado."""
    # Ordenar por orden lexicografico del codigo para que las columnas tengan
    # orden predecible y estable.
    cuentas_sorted = sorted(cuentas, key=lambda c: c["orden"])

    case_lines: list[str] = []
    for cta in cuentas_sorted:
        col = column_name(cta["codigo"])
        nombre = safe_comment(cta["nombre"])
        case_lines.append(
            f"    MAX(CASE WHEN cuenta_codigo = '{cta['codigo']}' "
            f"THEN valor END) AS {col}  /* {nombre} */"
        )

    case_sql = ",\n".join(case_lines)

    return f"""\
-- =========================================================================
-- AUTO-GENERATED por data-platform/scripts/generate_marts_sql.py
-- NO editar a mano. Si las cuentas cambian, regenerar y commitear de nuevo.
--
-- Vista materializada wide-format para EEFF tipo '{tipo_estado}'.
-- 1 fila por (periodo, nomb_correg, moneda).
-- 1 columna por cuenta canonica (cta_<codigo_sanitizado>).
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS marts.{view_name};

CREATE MATERIALIZED VIEW marts.{view_name} AS
SELECT
    periodo,
    fecha_cierre,
    nomb_correg,
    empresa_sbs,
    tipo_entidad,
    microfinanciera,
    nacional,
    moneda,
{case_sql}
FROM raw.eeff_observacion
WHERE tipo_estado = '{tipo_estado}'
GROUP BY periodo, fecha_cierre, nomb_correg, empresa_sbs,
         tipo_entidad, microfinanciera, nacional, moneda;

CREATE UNIQUE INDEX IF NOT EXISTS uq_{view_name}
    ON marts.{view_name} (periodo, nomb_correg, moneda);

CREATE INDEX IF NOT EXISTS idx_{view_name}_periodo
    ON marts.{view_name} (periodo);

CREATE INDEX IF NOT EXISTS idx_{view_name}_entidad
    ON marts.{view_name} (nomb_correg);

CREATE INDEX IF NOT EXISTS idx_{view_name}_tipo
    ON marts.{view_name} (tipo_entidad);

COMMENT ON MATERIALIZED VIEW marts.{view_name} IS
    'Pivot wide-format de EEFF {tipo_estado}. Auto-generado desde seeds.';
"""


def load_seed(category: str) -> list[dict]:
    path = SEEDS_DIR / f"cuentas_{category}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    balance = load_seed("balance")
    resultados = load_seed("resultados")

    bg_sql = build_view_sql(
        view_name="mv_eeff_balance_ancho",
        tipo_estado="balance",
        cuentas=balance,
    )
    er_sql = build_view_sql(
        view_name="mv_eeff_resultados_ancho",
        tipo_estado="resultados",
        cuentas=resultados,
    )

    bg_path = OUT_DIR / "V009__marts_eeff_balance_ancho.sql"
    er_path = OUT_DIR / "V010__marts_eeff_resultados_ancho.sql"

    bg_path.write_text(bg_sql, encoding="utf-8")
    er_path.write_text(er_sql, encoding="utf-8")

    print(f"# Generado:")
    print(f"  {bg_path}  ({len(balance)} cuentas)")
    print(f"  {er_path}  ({len(resultados)} cuentas)")
    print()
    print("Siguiente paso:")
    print("  git add infrastructure/postgres/migrations/V009__*.sql V010__*.sql")
    print("  git commit -m 'feat(marts): V009/V010 wide-format EEFF (auto-generated)'")
    print("  git push")


if __name__ == "__main__":
    main()
