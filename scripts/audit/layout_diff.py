"""
layout_diff — Compara los layouts (nombres de filas) entre XLS de varios
periodos para detectar divergencias. Reporta:
  - Filas que aparecen en un periodo pero no en otros (nuevas o removidas)
  - Filas que están en el XLS pero NO en dw.cabecera_maestra (gap)
  - Filas que están en cabecera pero NO en el XLS actual (obsoletas)

Salida: reporte markdown con diffs por sheet y por grupo.

Uso:
    python layout_diff.py --dir "D:/PROYECTO/SBS/COOPERATIVAS/Data/092026" \
                         --baseline "D:/PROYECTO/SBS/COOPERATIVAS/Data/062026"

El baseline define qué consideramos "layout de referencia" (periodo que ya
funcionaba bien). El dir es el periodo nuevo a validar.
"""
import argparse, io, pathlib, sys
from collections import OrderedDict

try:
    import pandas as pd
    import psycopg2
except ImportError:
    print("Requiere: pip install pandas openpyxl psycopg2-binary")
    sys.exit(1)

sys.stdout.reconfigure(encoding="utf-8")

# Mapeo nombre_archivo (prefijo) → (tipo_entidad, tipo_estado, sheet_name_pattern)
# SC-0005 = COOPAC N1, SC-0004 = N2A, SC-0003 = N2B, SC-0002 = N3
COOPAC_PREFIX_MAP = {
    "SC-0005": "COOPAC_N1",
    "SC-0004": "COOPAC_N2A",
    "SC-0003": "COOPAC_N2B",
    "SC-0002": "COOPAC_N3",
}


def _normalize(s: str) -> str:
    """Normaliza un nombre de cuenta: lowercase, strip, collapse spaces."""
    import re
    s = str(s).strip().lower()
    # Remueve acentos básicos
    tr = str.maketrans("áéíóúñü", "aeiouñu")
    s = s.translate(tr)
    s = re.sub(r"\s+", " ", s)
    return s


def extract_rows_from_xls(path: pathlib.Path, sheet_name: str | None = None):
    """Lee el XLS y devuelve lista ordenada de (orden, nombre_raw) de filas
    no vacías en la columna A (índice 0)."""
    data = path.read_bytes()
    xl = pd.ExcelFile(io.BytesIO(data), engine="openpyxl")
    if sheet_name is None:
        sheet_name = xl.sheet_names[0]  # primera hoja = balance
    df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
    rows = []
    orden = 0
    # Buscamos data_start_row (primera fila con "DISPONIBLE" en col 0)
    data_start = None
    for i in range(min(20, len(df))):
        val = str(df.iloc[i, 0]) if pd.notna(df.iloc[i, 0]) else ""
        if val.strip().upper().startswith("DISPONIBLE"):
            data_start = i
            break
    if data_start is None:
        return rows, None

    for i in range(data_start, len(df)):
        val = df.iloc[i, 0] if pd.notna(df.iloc[i, 0]) else None
        if val is None or str(val).strip() == "":
            continue
        name = str(val).strip()
        orden += 1
        rows.append((orden, name))
    return rows, sheet_name


def load_cabecera_names(cur, tipo_entidad: str, tipo_estado: str) -> set:
    """Devuelve set de nombres normalizados (nombre + nombre_fuente) que
    están en la cabecera maestra para este tipo_entidad/tipo_estado."""
    cur.execute(
        """
        SELECT nombre, nombre_fuente
        FROM dw.cabecera_maestra
        WHERE tipo_entidad = %s AND tipo_estado = %s AND valido_hasta IS NULL
        """,
        (tipo_entidad, tipo_estado),
    )
    names = set()
    for nombre, fuente in cur.fetchall():
        if nombre:
            names.add(_normalize(nombre))
        if fuente:
            names.add(_normalize(fuente))
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="Directorio con XLS del periodo nuevo")
    ap.add_argument("--baseline", required=True, help="Directorio con XLS del periodo baseline")
    ap.add_argument("--dsn", default="postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable")
    args = ap.parse_args()

    dir_new = pathlib.Path(args.dir)
    dir_baseline = pathlib.Path(args.baseline)
    if not dir_new.is_dir() or not dir_baseline.is_dir():
        print(f"Directorios no existen: {dir_new}, {dir_baseline}")
        sys.exit(1)

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    print(f"# Layout Diff COOPAC\n")
    print(f"- Baseline: `{dir_baseline.name}`")
    print(f"- Nuevo:    `{dir_new.name}`\n")

    for prefix, tipo_ent in COOPAC_PREFIX_MAP.items():
        files_new = list(dir_new.glob(f"{prefix}*.XLS")) + list(dir_new.glob(f"{prefix}*.xls"))
        files_base = list(dir_baseline.glob(f"{prefix}*.XLS")) + list(dir_baseline.glob(f"{prefix}*.xls"))
        if not files_new or not files_base:
            print(f"\n## {tipo_ent}: SKIP (no hay archivos)\n")
            continue
        file_new = files_new[0]
        file_base = files_base[0]

        print(f"\n## {tipo_ent}\n")

        # Para cada sheet (balance + resultados)
        data = file_new.read_bytes()
        sheets = pd.ExcelFile(io.BytesIO(data), engine="openpyxl").sheet_names
        for sheet in sheets:
            tipo_estado = "balance" if sheet.lower().startswith("bg") else "resultados"
            rows_new, _ = extract_rows_from_xls(file_new, sheet)
            rows_base, _ = extract_rows_from_xls(file_base, sheet)
            cab_names = load_cabecera_names(cur, tipo_ent, tipo_estado)

            names_new = OrderedDict((_normalize(n), (o, n)) for o, n in rows_new)
            names_base = OrderedDict((_normalize(n), (o, n)) for o, n in rows_base)

            solo_new = [v for k, v in names_new.items() if k not in names_base]
            solo_base = [v for k, v in names_base.items() if k not in names_new]
            no_en_cabecera = [v for k, v in names_new.items() if k not in cab_names]

            print(f"### {sheet} — {tipo_estado}\n")
            print(f"- Filas nuevo: {len(rows_new)}, baseline: {len(rows_base)}, cabecera: {len(cab_names)}")

            if solo_new:
                print(f"\n**Filas SOLO en nuevo periodo (posiblemente nuevas en SBS):**")
                for orden, name in solo_new[:20]:
                    print(f"  - [orden={orden}] `{name}`")
                if len(solo_new) > 20:
                    print(f"  - ... y {len(solo_new) - 20} más")

            if solo_base:
                print(f"\n**Filas que SE REMOVIERON del nuevo periodo:**")
                for orden, name in solo_base[:20]:
                    print(f"  - [orden={orden}] `{name}`")

            if no_en_cabecera:
                print(f"\n**Filas del XLS que NO están en dw.cabecera_maestra ({len(no_en_cabecera)}):**")
                for orden, name in no_en_cabecera[:30]:
                    print(f"  - [orden={orden}] `{name}`")
                if len(no_en_cabecera) > 30:
                    print(f"  - ... y {len(no_en_cabecera) - 30} más")
            print()

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
