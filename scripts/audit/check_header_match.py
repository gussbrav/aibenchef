"""Verificar que cada header L1/L2 del XLS matchea con un nombre en la cabecera."""
import psycopg2, sys, io, pathlib, re
sys.stdout.reconfigure(encoding="utf-8")

try:
    import pandas as pd
except ImportError:
    print("needs: pip install pandas openpyxl")
    sys.exit(1)

DSN = "postgres://postgres:Azoramind_1234@panel.azoramind.com:5433/aibenchef?sslmode=disable"


def _normalize(s):
    s = str(s).strip().lower()
    tr = str.maketrans("áéíóúü", "aeiouu")
    s = s.translate(tr)
    s = s.replace("ñ", "n")
    s = re.sub(r"\s+", " ", s)
    return s


def extract_headers(path, sheet_idx):
    """Devuelve lista de headers (uppercase) del XLS con orden."""
    data = pathlib.Path(path).read_bytes()
    xl = pd.ExcelFile(io.BytesIO(data), engine="openpyxl")
    sheet = xl.sheet_names[sheet_idx]
    df = pd.read_excel(xl, sheet_name=sheet, header=None)
    start = None
    for i in range(min(20, len(df))):
        val = str(df.iloc[i, 0]) if pd.notna(df.iloc[i, 0]) else ""
        if val.strip().upper().startswith("DISPONIBLE") or val.strip().upper().startswith("INGRESOS"):
            start = i
            break
    if start is None:
        return [], sheet
    headers = []
    orden = 0
    for i in range(start, len(df)):
        val = df.iloc[i, 0] if pd.notna(df.iloc[i, 0]) else None
        if val is None or str(val).strip() == "":
            continue
        orden += 1
        name = str(val).strip()
        # Es header: uppercase
        if name == name.upper() and len(name) >= 3:
            headers.append((orden, name))
    return headers, sheet


DIR = "D:/PROYECTO/SBS/COOPERATIVAS/Data/092026"
FILES = [
    ("COOPAC_N1", "SC-0005-se2026.XLS"),
    ("COOPAC_N2A", "SC-0004-se2026.XLS"),
    ("COOPAC_N2B", "SC-0003-se2026.XLS"),
    ("COOPAC_N3", "SC-0002-se2026.XLS"),
]

conn = psycopg2.connect(DSN)
cur = conn.cursor()

for tipo_ent, fname in FILES:
    path = f"{DIR}/{fname}"
    if not pathlib.Path(path).exists():
        print(f"\n{tipo_ent}: file not found")
        continue
    for sheet_idx, tipo_estado in [(0, "balance"), (1, "resultados")]:
        headers, sheet = extract_headers(path, sheet_idx)
        # Cargar nombres de cabecera
        cur.execute(
            """
            SELECT codigo, nombre, COALESCE(nombre_fuente, nombre)
            FROM dw.cabecera_maestra
            WHERE tipo_entidad = %s AND tipo_estado = %s AND valido_hasta IS NULL
            """,
            (tipo_ent, tipo_estado),
        )
        name_to_code = {}
        for codigo, nombre, fuente in cur.fetchall():
            name_to_code[_normalize(nombre)] = codigo
            if fuente:
                name_to_code[_normalize(fuente)] = codigo
        print(f"\n=== {tipo_ent} / {sheet} ({tipo_estado}) — {len(headers)} headers uppercase ===")
        matched = 0
        unmatched = []
        for orden, name in headers:
            n = _normalize(name)
            if n in name_to_code:
                matched += 1
            else:
                unmatched.append((orden, name))
        print(f"Headers matcheados: {matched}/{len(headers)}")
        if unmatched:
            print("Headers SIN MATCH:")
            for o, n in unmatched[:15]:
                print(f"  orden={o}: {n}")
            if len(unmatched) > 15:
                print(f"  ... y {len(unmatched) - 15} más")

cur.close()
conn.close()
