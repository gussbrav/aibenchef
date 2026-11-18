"""Script auto-contenido para correr dentro del container aibenchef-data.
Compara layouts COOPAC Jun 2026 vs Sep 2026 y reporta gaps vs cabecera maestra.
"""
import io, pathlib, sys
from collections import OrderedDict

import pandas as pd
import psycopg2

sys.stdout.reconfigure(encoding="utf-8")

DSN = "postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable"

LEVELS = [
    ("COOPAC_N1", "SC-0005", 6, 9),
    ("COOPAC_N2A", "SC-0004", 6, 9),
    ("COOPAC_N2B", "SC-0003", 6, 9),
    ("COOPAC_N3", "SC-0002", 6, 9),
]

MONTH_ABR = {6: "jn", 9: "se"}


def _normalize(s):
    import re
    s = str(s).strip().lower()
    # Normaliza acentos — usamos escape unicode explicito para sobrevivir pipe SSH/encoding
    acentos = "áéíóúü"  # a e i o u ü
    tr = str.maketrans(acentos, "aeiouu")
    s = s.translate(tr)
    s = s.replace("ñ", "n")  # ñ -> n
    s = re.sub(r"\s+", " ", s)
    return s


def extract_rows(path, sheet_idx=0):
    data = pathlib.Path(path).read_bytes()
    xl = pd.ExcelFile(io.BytesIO(data), engine="openpyxl")
    sheet = xl.sheet_names[sheet_idx]
    df = pd.read_excel(xl, sheet_name=sheet, header=None)
    # Buscar data_start_row
    start = None
    for i in range(min(20, len(df))):
        val = str(df.iloc[i, 0]) if pd.notna(df.iloc[i, 0]) else ""
        if val.strip().upper().startswith("DISPONIBLE") or val.strip().upper().startswith("INGRESOS"):
            start = i
            break
    if start is None:
        return [], sheet
    rows = []
    orden = 0
    for i in range(start, len(df)):
        val = df.iloc[i, 0] if pd.notna(df.iloc[i, 0]) else None
        if val is None or str(val).strip() == "":
            continue
        orden += 1
        rows.append((orden, str(val).strip()))
    return rows, sheet


def load_cab_names(cur, tipo_ent, tipo_estado):
    cur.execute(
        """
        SELECT nombre, nombre_fuente, codigo, orden
        FROM dw.cabecera_maestra
        WHERE tipo_entidad = %s AND tipo_estado = %s AND valido_hasta IS NULL
        """,
        (tipo_ent, tipo_estado),
    )
    names = set()
    entries = []
    for nombre, fuente, codigo, orden in cur.fetchall():
        if nombre:
            names.add(_normalize(nombre))
        if fuente:
            names.add(_normalize(fuente))
        entries.append((codigo, nombre, fuente, orden))
    return names, entries


def main():
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()
    print(f"# Layout Diff COOPAC — Jun 2026 (baseline) vs Sep 2026\n")

    for tipo_ent, prefix, mes_base, mes_new in LEVELS:
        nivel_dir = tipo_ent.lower()
        path_base = f"/app/local-data/raw/{nivel_dir}/eeff/2026/{mes_base:02d}/{prefix}-{MONTH_ABR[mes_base]}2026.xls"
        path_new = f"/app/local-data/raw/{nivel_dir}/eeff/2026/{mes_new:02d}/{prefix}-{MONTH_ABR[mes_new]}2026.xls"
        if not pathlib.Path(path_base).exists() or not pathlib.Path(path_new).exists():
            print(f"\n## {tipo_ent}: SKIP (archivos no encontrados)\n")
            continue

        print(f"\n## {tipo_ent}\n")
        # Sheet 0 = balance (BG_*), sheet 1 = resultados (GYP_*)
        for sheet_idx, tipo_estado in [(0, "balance"), (1, "resultados")]:
            rows_base, sheet_name_b = extract_rows(path_base, sheet_idx)
            rows_new, sheet_name_n = extract_rows(path_new, sheet_idx)
            cab_names, cab_entries = load_cab_names(cur, tipo_ent, tipo_estado)

            print(f"### {sheet_name_n} ({tipo_estado})\n")
            print(f"- Baseline (Jun): {len(rows_base)} filas")
            print(f"- Nuevo (Sep):    {len(rows_new)} filas")
            print(f"- Cabecera:       {len(cab_entries)} entradas, {len(cab_names)} nombres únicos")

            names_base = {_normalize(n): (o, n) for o, n in rows_base}
            names_new = {_normalize(n): (o, n) for o, n in rows_new}

            solo_new = [v for k, v in names_new.items() if k not in names_base]
            solo_base = [v for k, v in names_base.items() if k not in names_new]
            no_cab = [v for k, v in names_new.items() if k not in cab_names]

            if solo_new:
                print(f"\n**Filas SOLO en Sep (nuevas en SBS):**")
                for o, n in solo_new:
                    print(f"  - orden={o}: `{n}`")
            if solo_base:
                print(f"\n**Filas que SE QUITARON de Sep:**")
                for o, n in solo_base:
                    print(f"  - orden={o}: `{n}`")
            if no_cab:
                print(f"\n**Filas del XLS Sep que NO están en cabecera ({len(no_cab)}):**")
                for o, n in no_cab:
                    print(f"  - orden={o}: `{n}`")
            print()

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
