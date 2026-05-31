"""Genera el golden dataset del parser EEFF desde BASE EE.FF..xlsx.

El golden es la fuente de verdad financiera mantenida a mano por Gus en
`D:\\PROYECTO\\SBS\\BASES EXCEL\\BASE EE.FF..xlsx`. Este script toma un
muestreo estratificado y lo guarda en parquet bajo `tests/golden/` para que
los tests puedan iterar rapido sin re-leer el Excel cada vez.

Uso:
    uv run python scripts/build_golden_eeff.py
    uv run python scripts/build_golden_eeff.py --samples-per-grupo 10 --seed 42

Output:
    tests/golden/eeff_golden.parquet

Estructura del parquet:
    | empresa_sbs | nomb_correg | tipo_entidad | periodo | moneda |
    | tipo_estado | cuenta_label | cuenta_codigo | valor_esperado |

Donde:
    - tipo_estado: 'balance' | 'resultados'
    - cuenta_codigo: extraido del label "(A1.1) Caja" -> "A1.1"
    - valor_esperado: float — el numero que el parser tiene que reproducir
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

GOLD_SOURCE = Path(r"D:\PROYECTO\SBS\BASES EXCEL\BASE EE.FF..xlsx")
OUTPUT_PATH = Path(__file__).parent.parent / "tests" / "golden" / "eeff_golden.parquet"

# Columnas dimensionales esperadas en BG/ER del Excel canonico
DIM_COLS = [
    "code",
    "MES",
    "TIPO ENTIDAD",
    "MICROFINAN.",
    "NACIONAL",
    "EMPRESA SBS",
    "NOMB_CORREG",
    "MONEDA",
]

# Regex que extrae el codigo regulatorio del label SBS:
#   "      (A1) DISPONIBLE"           -> "A1"
#   "             (A1.1) Caja"        -> "A1.1"
#   "(1) INGRESOS FINANCIEROS"        -> "1"
#   "     (1.1) Disponibles"          -> "1.1"
_CODE_RE = re.compile(r"^\s*\(([A-Z]?\d+(?:\.\d+)*)\)\s*(.*)$")


def extract_codigo_y_nombre(col: str) -> tuple[str | None, str]:
    """De un header como '(A1.1) Caja' devuelve ('A1.1', 'Caja').

    Devuelve (None, col) si el header no matchea el patron canonico.
    """
    m = _CODE_RE.match(col)
    if not m:
        return None, col.strip()
    return m.group(1), m.group(2).strip()


def mes_to_periodo(mes_value: object) -> int | None:
    """Convierte un valor de columna MES (datetime o string) a periodo YYYYMM."""
    if pd.isna(mes_value):
        return None
    if isinstance(mes_value, pd.Timestamp):
        return mes_value.year * 100 + mes_value.month
    # Best effort para strings
    try:
        ts = pd.to_datetime(mes_value)
        return ts.year * 100 + ts.month
    except (ValueError, TypeError):
        return None


def melt_sheet(df: pd.DataFrame, tipo_estado: str) -> pd.DataFrame:
    """Convierte la hoja ancha (cuentas como columnas) a formato largo.

    Una fila por (dim + cuenta). Filas con valor NaN se descartan: el parser
    no tiene que producir esos valores (no estan en el archivo SBS de
    origen) y compararlos generaria falsos positivos.
    """
    dim_cols_present = [c for c in DIM_COLS if c in df.columns]
    cuenta_cols = [c for c in df.columns if c not in dim_cols_present]

    long_df = df.melt(
        id_vars=dim_cols_present,
        value_vars=cuenta_cols,
        var_name="cuenta_label",
        value_name="valor_esperado",
    )

    long_df = long_df[long_df["valor_esperado"].notna()].copy()

    # Extraer codigo regulatorio
    codes_names = long_df["cuenta_label"].map(extract_codigo_y_nombre)
    long_df["cuenta_codigo"] = codes_names.map(lambda t: t[0])
    long_df["cuenta_nombre"] = codes_names.map(lambda t: t[1])

    # Filtrar filas sin codigo: son cuentas de calculo / notas, no las
    # esperamos del parser (que opera sobre las cuentas oficiales SBS).
    long_df = long_df[long_df["cuenta_codigo"].notna()].copy()

    # Periodo
    long_df["periodo"] = long_df["MES"].map(mes_to_periodo)
    long_df = long_df[long_df["periodo"].notna()].copy()
    long_df["periodo"] = long_df["periodo"].astype("int64")

    long_df["tipo_estado"] = tipo_estado

    # Normalizar nombres de columna
    long_df = long_df.rename(
        columns={
            "EMPRESA SBS": "empresa_sbs",
            "NOMB_CORREG": "nomb_correg",
            "TIPO ENTIDAD": "tipo_entidad",
            "MONEDA": "moneda",
            "MICROFINAN.": "microfinanciera",
            "NACIONAL": "nacional",
            "code": "code_entidad",
        }
    )

    return long_df[
        [
            "empresa_sbs",
            "nomb_correg",
            "tipo_entidad",
            "periodo",
            "moneda",
            "tipo_estado",
            "cuenta_codigo",
            "cuenta_nombre",
            "valor_esperado",
        ]
    ]


def sample_stratified(
    df: pd.DataFrame,
    samples_per_grupo: int,
    seed: int,
) -> pd.DataFrame:
    """Toma N (entidad, periodo) por tipo_entidad de forma reproducible.

    Estratifica por (tipo_entidad, periodo_anio) para que el muestreo cubra
    grupos y anios diversos, no solo lo mas reciente.
    """
    if "tipo_entidad" not in df.columns or "periodo" not in df.columns:
        return df

    df = df.copy()
    df["_anio"] = df["periodo"] // 100

    keys = df[["empresa_sbs", "periodo", "moneda", "tipo_entidad", "_anio"]].drop_duplicates()

    # Muestreo manual sin groupby.apply (mas predecible)
    samples_per_stratum = max(1, samples_per_grupo // 5)
    sampled_parts: list[pd.DataFrame] = []
    for (_tipo, _anio), stratum in keys.groupby(["tipo_entidad", "_anio"]):
        n = min(len(stratum), samples_per_stratum)
        sampled_parts.append(stratum.sample(n=n, random_state=seed))

    if not sampled_parts:
        return df.drop(columns=["_anio"], errors="ignore")

    sampled_keys = pd.concat(sampled_parts, ignore_index=True)[
        ["empresa_sbs", "periodo", "moneda", "tipo_entidad"]
    ].drop_duplicates()

    merged = df.merge(
        sampled_keys,
        on=["empresa_sbs", "periodo", "moneda", "tipo_entidad"],
        how="inner",
    )
    return merged.drop(columns=["_anio"], errors="ignore")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=GOLD_SOURCE,
        help=f"Path al BASE EE.FF..xlsx canonico (default: {GOLD_SOURCE})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_PATH,
        help=f"Path al parquet de salida (default: {OUTPUT_PATH})",
    )
    parser.add_argument(
        "--samples-per-grupo",
        type=int,
        default=20,
        help="Muestras aprox por tipo_entidad (distribuidas en anios). 0 = todo.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Seed reproducible para el muestreo",
    )
    args = parser.parse_args()

    if not args.source.exists():
        print(f"ERROR: no se encuentra el source: {args.source}", file=sys.stderr)
        print(
            "Verifica que BASE EE.FF..xlsx exista. Si esta en otro path, pasalo con --source.",
            file=sys.stderr,
        )
        return 1

    print(f"Leyendo {args.source} ...")
    bg = pd.read_excel(args.source, sheet_name="BG")
    er = pd.read_excel(args.source, sheet_name="ER")
    print(f"  BG: {bg.shape}, ER: {er.shape}")

    print("Convirtiendo a formato largo ...")
    bg_long = melt_sheet(bg, tipo_estado="balance")
    er_long = melt_sheet(er, tipo_estado="resultados")
    print(f"  BG long: {len(bg_long):,} filas")
    print(f"  ER long: {len(er_long):,} filas")

    combined = pd.concat([bg_long, er_long], ignore_index=True)

    if args.samples_per_grupo > 0:
        print(f"Muestreo estratificado: ~{args.samples_per_grupo} por tipo_entidad ...")
        combined = sample_stratified(combined, args.samples_per_grupo, args.seed)
        print(f"  Total muestreado: {len(combined):,} filas")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    combined.to_parquet(args.output, index=False, compression="snappy")
    print(f"\nGolden dataset escrito en: {args.output}")
    print(f"  Filas: {len(combined):,}")
    print(f"  Cobertura entidades: {combined['empresa_sbs'].nunique()}")
    print(f"  Cobertura periodos: {combined['periodo'].nunique()}")
    print(f"  Cobertura cuentas: {combined['cuenta_codigo'].nunique()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
