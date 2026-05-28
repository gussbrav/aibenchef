"""F1 (issue #42): auditor de cabeceras SBS por año.

Recorre los archivos historicos de SBS guardados en disco
(`d:\\PROYECTO\\SBS\\Extraer data de pagina SBS\\`), extrae para cada
archivo la secuencia de filas (orden, nombre, es_header, tipo_estado),
y produce:

  1) `out/sbs_headers_per_file.jsonl` — una linea JSON por archivo con
     su secuencia de cuentas tal cual aparece en SBS.
  2) `out/sbs_drift_matrix_<grupo>.csv` — matriz nombre_normalizado x año
     marcando en qué años aparece cada cuenta para ese grupo.
  3) `out/sbs_drift_summary.md` — reporte ejecutivo: cuentas nuevas /
     eliminadas / renombradas por (grupo, año).

Modo solo-lectura: NO toca DB, NO modifica archivos SBS. Reusa el parser
de produccion (read_xls + _detect_layout + _is_annotation_or_footnote_extra)
para que el output sea consistente con como el importer "ve" cada archivo.

Issue #42.

Uso:
    uv run python scripts/audit_sbs_headers_history.py [--samples-per-year 1]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path

# Reusamos primitives del importer en lugar de duplicar logica
from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
    _cell_str,
    _detect_layout,
    _is_annotation_or_footnote_extra,
    _normalize,
)
from aibenchef_data.domains.parsing import XlsSheet, read_xls

ROOT = Path(r"D:\PROYECTO\SBS\Extraer data de pagina SBS")

GRUPO_DIRS: dict[str, str] = {
    "BANCOS": "01_Entidad_Banca_Multiple",
    "FINANCIERAS": "02_Entidad_Empresas_Financiera",
    "CMAC": "03_Entidad_CajaMunicipales",
    "CRAC": "04_Entidad_CajaRurales",
    "EDPYMES": "05_Entidad_Edpymes",
}

# SBS usa abreviaturas de mes en castellano: en, fe, ma, ab, my, jn, jl, ag, se, oc, no, di.
MES_ABBR_TO_NUM: dict[str, int] = {
    "en": 1,
    "fe": 2,
    "ma": 3,
    "ab": 4,
    "my": 5,
    "jn": 6,
    "jl": 7,
    "ag": 8,
    "se": 9,
    "oc": 10,
    "no": 11,
    "di": 12,
}

FILENAME_RE = re.compile(r"-(en|fe|ma|ab|my|jn|jl|ag|se|oc|no|di)(\d{4})\.xls", re.IGNORECASE)

# Identificadores de sheets a evaluar — varios formatos historicos:
#   - CMAC/CRAC/EDPYME (BIFF moderno): "bg_..." / "gyp_..."
#   - FINANCIERAS/BANCOS (BIFF 2010-2016): "BG-Fin", "EGP-Fin", "BG-Banca", "EGP-Banca"
#   - Layouts mas viejos: heuristica por titulo en filas 0..3 col 0..2.
SHEET_PREFIX_TO_TIPO_ESTADO: dict[str, str] = {
    "bg_": "balance",
    "gyp_": "resultados",
    "bg-": "balance",
    "egp-": "resultados",
    "bg ": "balance",
    "egp ": "resultados",
}

OUT_DIR = Path(__file__).parent.parent / "out"


@dataclass(frozen=True, slots=True)
class FileMeta:
    grupo: str
    archivo: str
    anio: int
    mes: int
    periodo: int  # YYYYMM

    @property
    def relpath(self) -> str:
        return f"{self.grupo}/{self.anio}/{self.archivo}"


@dataclass(frozen=True, slots=True)
class RowExtracted:
    orden: int
    nombre_raw: str
    nombre_norm: str
    es_header: bool
    section: str  # 'A' | 'B' | 'C' | '' (resultados)


def discover_files() -> Iterator[tuple[FileMeta, Path]]:
    """Camina los 5 grupos buscando archivos EEFF .xls y emite metadata."""
    for grupo, sub in GRUPO_DIRS.items():
        eeff_root = ROOT / sub / "01_EEFF_SBS"
        if not eeff_root.is_dir():
            print(f"  [skip] {grupo}: no existe {eeff_root}", file=sys.stderr)
            continue
        for path in sorted(eeff_root.rglob("*.xls*")):
            if path.suffix.lower() not in (".xls", ".xlsx", ".xlsb"):
                continue
            m = FILENAME_RE.search(path.name)
            if not m:
                continue
            mes_abbr = m.group(1).lower()
            anio = int(m.group(2))
            mes = MES_ABBR_TO_NUM.get(mes_abbr)
            if not mes:
                continue
            periodo = anio * 100 + mes
            yield (
                FileMeta(
                    grupo=grupo,
                    archivo=path.name,
                    anio=anio,
                    mes=mes,
                    periodo=periodo,
                ),
                path,
            )


def pick_samples(
    files: Iterable[tuple[FileMeta, Path]],
    samples_per_year: int,
) -> list[tuple[FileMeta, Path]]:
    """Para cada (grupo, anio) selecciona <samples_per_year> meses (preferimos enero).

    Si solo hay 1 muestra por año, basta para detectar drift de cabecera
    (los cambios de layout suelen ocurrir en enero o tras una resolucion SBS).
    """
    bucket: dict[tuple[str, int], list[tuple[FileMeta, Path]]] = defaultdict(list)
    for meta, path in files:
        bucket[(meta.grupo, meta.anio)].append((meta, path))

    out: list[tuple[FileMeta, Path]] = []
    for (_grupo, _anio), items in sorted(bucket.items()):
        items.sort(key=lambda x: x[0].mes)
        # Tomar primer mes + el mes en el medio si >= 6 muestras + el ultimo si ambos no son enero/diciembre
        chosen: list[tuple[FileMeta, Path]] = []
        if items:
            chosen.append(items[0])  # primero del año
        if samples_per_year >= 2 and len(items) >= 2:
            chosen.append(items[-1])  # ultimo del año
        if samples_per_year >= 3 and len(items) >= 3:
            chosen.append(items[len(items) // 2])  # medio del año
        # de-dup por (grupo, anio, mes)
        seen: set[tuple[str, int, int]] = set()
        for meta, p in chosen:
            key = (meta.grupo, meta.anio, meta.mes)
            if key in seen:
                continue
            seen.add(key)
            out.append((meta, p))
    return out


def find_eeff_sheets(sheets: list[XlsSheet]) -> dict[str, XlsSheet]:
    """Devuelve {tipo_estado: sheet} para las hojas que parecen balance/resultados.

    Estrategia:
      1) Por prefix de nombre (bg_/gyp_ para CMAC/CRAC/EDPYME).
      2) Si no, buscar titulo en col 0 rows 0..4 con palabras "BALANCE" o
         "ESTADO DE GANANCIAS"/"RESULTADOS".
    """
    out: dict[str, XlsSheet] = {}
    for sh in sheets:
        name_lc = sh.name.lower()
        for prefix, tipo in SHEET_PREFIX_TO_TIPO_ESTADO.items():
            if name_lc.startswith(prefix):
                out.setdefault(tipo, sh)
                break

    if "balance" in out and "resultados" in out:
        return out

    # Heuristica por titulo — scaneamos col 0..2 porque layouts 2010-2015
    # ponen el titulo en col 1 con col 0 vacio.
    for sh in sheets:
        title_chunks: list[str] = []
        for r in range(0, 5):
            for c in range(0, 3):
                v = _cell_str(sh, r, c)
                if v:
                    title_chunks.append(v.upper())
        title = " | ".join(title_chunks)
        if "BALANCE" in title and "balance" not in out:
            out["balance"] = sh
        elif (
            "GANANCIAS Y PERDIDAS" in title
            or "GANANCIAS Y P[?]RDIDAS" in title  # con char SBS escapado
            or "ESTADO DE GANANCIAS" in title
            or ("RESULTADOS" in title and "GASTOS" in title)
        ) and "resultados" not in out:
            out["resultados"] = sh
    return out


def extract_rows(sheet: XlsSheet, tipo_estado: str) -> list[RowExtracted]:
    """Reproduce la logica del importer para extraer la secuencia (orden, nombre).

    NO consulta DB. NO asigna codigo. Solo emite lo que el archivo trae.
    Si _detect_layout falla, retorna lista vacia y emite warning.
    """
    try:
        layout = _detect_layout(sheet)
    except Exception as exc:
        print(f"    [warn] _detect_layout fallo: {exc}", file=sys.stderr)
        return []

    current_section = "A" if tipo_estado == "balance" else ""
    section_markers = {
        "activo": "A",
        "pasivo": "B",
        "patrimonio": "C",
        "patrimonio neto": "C",
    }

    rows: list[RowExtracted] = []
    orden = 0
    for r in range(layout.data_start_row, sheet.n_rows):
        nombre_raw = _cell_str(sheet, r, 0)
        if not nombre_raw:
            continue
        nombre_norm = _normalize(nombre_raw)

        if tipo_estado == "balance" and nombre_norm in section_markers:
            current_section = section_markers[nombre_norm]
            continue

        orden += 1

        if _is_annotation_or_footnote_extra(nombre_raw):
            orden -= 1
            continue

        es_header = nombre_raw.strip() == nombre_raw.strip().upper()
        rows.append(
            RowExtracted(
                orden=orden,
                nombre_raw=nombre_raw.strip(),
                nombre_norm=nombre_norm,
                es_header=es_header,
                section=current_section,
            )
        )
    return rows


def write_per_file_jsonl(samples: list[tuple[FileMeta, Path]], out_path: Path) -> int:
    """Escribe una linea JSON por (archivo, tipo_estado). Devuelve count OK."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    n_ok = 0
    n_err = 0
    with out_path.open("w", encoding="utf-8") as fh:
        for meta, path in samples:
            try:
                sheets = read_xls(path)
            except Exception as exc:
                print(f"  [skip] {meta.relpath}: read_xls fallo: {exc}", file=sys.stderr)
                n_err += 1
                continue
            picked = find_eeff_sheets(sheets)
            if not picked:
                print(f"  [skip] {meta.relpath}: sin sheets EEFF identificables", file=sys.stderr)
                n_err += 1
                continue
            for tipo_estado, sh in picked.items():
                rows = extract_rows(sh, tipo_estado)
                if not rows:
                    continue
                fh.write(
                    json.dumps(
                        {
                            "grupo": meta.grupo,
                            "archivo": meta.archivo,
                            "anio": meta.anio,
                            "mes": meta.mes,
                            "periodo": meta.periodo,
                            "tipo_estado": tipo_estado,
                            "sheet": sh.name,
                            "n_rows": len(rows),
                            "rows": [asdict(r) for r in rows],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                n_ok += 1
    return n_ok


def build_drift_matrix(jsonl_path: Path, out_dir: Path) -> None:
    """Lee el JSONL y produce 1 CSV por (grupo, tipo_estado) con matrix
    nombre_norm x anio, marcando X si esa cuenta aparece en al menos 1 mes
    del año.
    """
    # presence[(grupo, tipo_estado)][nombre_norm] = {anio: nombre_raw_ejemplo}
    presence: dict[tuple[str, str], dict[str, dict[int, str]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    anios_per_key: dict[tuple[str, str], set[int]] = defaultdict(set)
    with jsonl_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            obj = json.loads(line)
            key = (obj["grupo"], obj["tipo_estado"])
            anios_per_key[key].add(obj["anio"])
            for row in obj["rows"]:
                nombre_norm = row["nombre_norm"]
                anio = obj["anio"]
                presence[key][nombre_norm].setdefault(anio, row["nombre_raw"])

    out_dir.mkdir(parents=True, exist_ok=True)
    for (grupo, tipo_estado), per_nombre in sorted(presence.items()):
        anios_sorted = sorted(anios_per_key[(grupo, tipo_estado)])
        csv_path = out_dir / f"sbs_drift_matrix_{grupo}_{tipo_estado}.csv"
        with csv_path.open("w", encoding="utf-8", newline="") as csv_fh:
            # header
            csv_fh.write("nombre_normalizado;ejemplo_nombre_raw")
            for a in anios_sorted:
                csv_fh.write(f";{a}")
            csv_fh.write(";n_anios_presente\n")
            # rows
            rows_sorted = sorted(per_nombre.items(), key=lambda kv: (-len(kv[1]), kv[0]))
            for nombre_norm, per_anio in rows_sorted:
                ejemplo = next(iter(per_anio.values()), "")
                # escapar ; en nombres por las dudas
                nombre_csv = nombre_norm.replace(";", ",")
                ejemplo_csv = ejemplo.replace(";", ",")
                csv_fh.write(f"{nombre_csv};{ejemplo_csv}")
                for a in anios_sorted:
                    csv_fh.write(f";{'X' if a in per_anio else ''}")
                csv_fh.write(f";{len(per_anio)}\n")
        print(
            f"  wrote {csv_path.name}: {len(per_nombre)} cuentas únicas x {len(anios_sorted)} años"
        )


def build_drift_summary(jsonl_path: Path, out_md: Path) -> None:
    """Reporte ejecutivo en MD:
    - Por (grupo, tipo_estado): cuentas que aparecen en año N pero no N-1
      (NUEVAS) y vice-versa (ELIMINADAS).
    """
    # cuentas_por_anio[(grupo, tipo_estado, anio)] = set(nombre_norm)
    cuentas_por_anio: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    raw_ejemplo: dict[tuple[str, str, str], str] = {}
    with jsonl_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            obj = json.loads(line)
            key = (obj["grupo"], obj["tipo_estado"], obj["anio"])
            for row in obj["rows"]:
                cuentas_por_anio[key].add(row["nombre_norm"])
                raw_ejemplo.setdefault(
                    (obj["grupo"], obj["tipo_estado"], row["nombre_norm"]),
                    row["nombre_raw"],
                )

    out_md.parent.mkdir(parents=True, exist_ok=True)
    grupos_estados = sorted({(g, t) for (g, t, _) in cuentas_por_anio})
    with out_md.open("w", encoding="utf-8") as fh:
        fh.write("# SBS headers drift report\n\n")
        fh.write(
            "Comparativo año-a-año de las cuentas (nombre normalizado) que aparecen "
            "en los archivos SBS. Detecta capas de drift que el parser posicional "
            "(`dw.cabecera_maestra`) no captura.\n\n"
        )
        fh.write("Issue #42.\n\n---\n\n")
        for grupo, tipo_estado in grupos_estados:
            anios = sorted(a for (g, t, a) in cuentas_por_anio if (g, t) == (grupo, tipo_estado))
            fh.write(f"## {grupo} — {tipo_estado}\n\n")
            fh.write(f"Años con muestra: {anios[0]}-{anios[-1]} ({len(anios)} años)\n\n")

            cambios = []
            for i, anio in enumerate(anios[1:], start=1):
                prev = cuentas_por_anio[(grupo, tipo_estado, anios[i - 1])]
                curr = cuentas_por_anio[(grupo, tipo_estado, anio)]
                nuevas = curr - prev
                eliminadas = prev - curr
                if not nuevas and not eliminadas:
                    continue
                cambios.append(
                    {
                        "anio": anio,
                        "vs": anios[i - 1],
                        "nuevas": sorted(nuevas),
                        "eliminadas": sorted(eliminadas),
                    }
                )

            if not cambios:
                fh.write("Sin drift detectado en el periodo cubierto.\n\n")
                continue

            for change in cambios:
                fh.write(f"### {change['anio']} vs {change['vs']}\n\n")
                if change["nuevas"]:
                    fh.write(f"**Cuentas NUEVAS ({len(change['nuevas'])}):**\n")
                    for n in change["nuevas"][:25]:
                        ej = raw_ejemplo.get((grupo, tipo_estado, n), n)
                        fh.write(f'- `{n}` (raw: "{ej}")\n')
                    if len(change["nuevas"]) > 25:
                        fh.write(f"- ... +{len(change['nuevas']) - 25} más\n")
                    fh.write("\n")
                if change["eliminadas"]:
                    fh.write(f"**Cuentas ELIMINADAS ({len(change['eliminadas'])}):**\n")
                    for n in change["eliminadas"][:25]:
                        ej = raw_ejemplo.get((grupo, tipo_estado, n), n)
                        fh.write(f'- `{n}` (raw: "{ej}")\n')
                    if len(change["eliminadas"]) > 25:
                        fh.write(f"- ... +{len(change['eliminadas']) - 25} más\n")
                    fh.write("\n")
            fh.write("---\n\n")
    print(f"  wrote {out_md}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--samples-per-year",
        type=int,
        default=1,
        help="Cuántos meses muestrear por año (default 1=enero).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=OUT_DIR,
        help=f"Directorio de output (default: {OUT_DIR}).",
    )
    args = parser.parse_args()

    if not ROOT.exists():
        print(f"ERROR: directorio raiz no existe: {ROOT}", file=sys.stderr)
        return 2

    print(f"# Discover en {ROOT}")
    files = list(discover_files())
    print(f"# {len(files)} archivos detectados")

    samples = pick_samples(files, samples_per_year=args.samples_per_year)
    print(f"# {len(samples)} archivos seleccionados como muestra")

    jsonl_path = args.out_dir / "sbs_headers_per_file.jsonl"
    n_ok = write_per_file_jsonl(samples, jsonl_path)
    print(f"# {n_ok} archivos parseados correctamente -> {jsonl_path}")

    print("# Generando drift matrix CSVs...")
    build_drift_matrix(jsonl_path, args.out_dir)

    summary_path = args.out_dir / "sbs_drift_summary.md"
    print("# Generando summary MD...")
    build_drift_summary(jsonl_path, summary_path)

    print("\n# DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
