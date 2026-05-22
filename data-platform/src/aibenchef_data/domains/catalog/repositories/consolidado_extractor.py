"""ConsolidadoExtractor — extrae el plan canonico MAESTRO desde los archivos
CONSOLIDADO BALANCE/GYP SBS.xlsx que Gus mantiene desde 2020.

Estructura de los CONSOLIDADO (segun screenshots del usuario):
    Col A: BANCOS         (super-set, mas completo)
    Col B: FINANCIERAS
    Col C: CAJAS (CMAC)
    Col D: CRACS
    Col E: EDPYMES
    Filas: nombres de cuentas en orden estructural SBS.

Regla clave: el plan de cualquier grupo MENOR (cajas, edpymes, etc.) esta
ALINEADO al de BANCOS por POSICION de fila. Las celdas vacias = esa cuenta
no aplica al grupo (en SBS aparecen como celdas amarillas en el archivo
master). Las cuentas BANCOS-only son el super-set.

Output: dict por tipo_estado (balance/resultados) con lista de cuentas:
    {
      "codigo": "A1.1",
      "nombre": "Caja",
      "tipo_estado": "balance",
      "nivel": 3,
      "parent_codigo": "A1",
      "orden": <int>,
      "aplica_a": ["BANCOS","FINANCIERAS","CMAC","CRAC","EDPYMES"]
    }

El codigo se infiere por la posicion + jerarquia (similar a
cuentas_canonicas_extractor pero aceptando que NO viene en el header).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.shared import ValidationError, get_logger

log = get_logger(__name__)


# Mapeo columna -> tipo_entidad. Indices basados en lo que mostro Gus.
_COL_TO_GRUPO = {
    0: "BANCOS",
    1: "FINANCIERAS",
    2: "CMAC",
    3: "CRAC",
    4: "EDPYMES",
}


@dataclass(frozen=True, slots=True)
class CuentaCanonica:
    codigo: str
    nombre: str
    tipo_estado: str
    nivel: int
    parent_codigo: str | None
    orden: int
    aplica_a: tuple[str, ...]


def extract_from_consolidado(
    *,
    balance_path: Path,
    gyp_path: Path,
) -> dict[str, list[CuentaCanonica]]:
    """Extrae plan canonico maestro desde CONSOLIDADO BALANCE/GYP SBS.xlsx.

    Devuelve dict { 'balance': [...], 'resultados': [...] }.
    """
    log.info("consolidado.extract.start", balance=str(balance_path), gyp=str(gyp_path))

    balance = _extract_one(balance_path, tipo_estado="balance")
    resultados = _extract_one(gyp_path, tipo_estado="resultados")

    log.info(
        "consolidado.extract.done",
        balance_count=len(balance),
        resultados_count=len(resultados),
    )
    return {"balance": balance, "resultados": resultados}


def _extract_one(path: Path, *, tipo_estado: str) -> list[CuentaCanonica]:
    sheets = read_xls(path)
    if not sheets:
        raise ValidationError(f"Archivo CONSOLIDADO sin hojas: {path}")
    sheet = sheets[0]  # primer hoja contiene el plan

    # Buscar fila de datos: la primera donde alguna columna A-E tiene texto
    # que no sea "BANCOS"/"FINANCIERAS"/etc (que serian headers de columna).
    header_terms = {
        "bancos",
        "financieras",
        "cajas",
        "cracs",
        "edpymes",
        "activo",
        "pasivo",
        "patrimonio",
    }

    cuentas: list[CuentaCanonica] = []
    orden = 0
    current_section_prefix = _initial_section_prefix(tipo_estado)
    # Para detectar nivel: las cabeceras MAYUSCULAS son top de seccion, las
    # mixed-case son hijas. En BANCOS hay indentacion explicita "   Caja".

    # Numerador autoincremental por seccion para asignar codigos.
    section_counters: dict[str, int] = {}  # ej {"A": 9, "B": 5}

    # Top-level por seccion: contadores actuales y ultimo header registrado
    last_header_codigo: str | None = None
    # Contadores de hijos por codigo de parent (ej {"A1": 4})
    child_counters: dict[str, int] = {}

    for row_idx in range(0, sheet.n_rows):
        # Recoger texto de cada columna A-E (descarta datetimes)
        cells_per_col: dict[int, str] = {}
        for col in _COL_TO_GRUPO:
            v = sheet.cell(row_idx, col)
            if v is None:
                continue
            if isinstance(v, (datetime, date)):
                continue  # filas de fecha de cierre
            s = str(v).strip()
            if not s:
                continue
            # Skipear strings que son datetimes serializados
            if _looks_like_datetime(s):
                continue
            cells_per_col[col] = s

        if not cells_per_col:
            continue

        # Tomar el nombre del primer match no vacio
        nombre_raw = next(iter(cells_per_col.values()))
        nombre_lower = nombre_raw.strip().lower()

        # Filtrar metadata (headers de columna, marcadores, titulos)
        if nombre_lower in header_terms:
            if tipo_estado == "balance" and nombre_lower in ("activo", "pasivo", "patrimonio"):
                current_section_prefix = {"activo": "A", "pasivo": "B", "patrimonio": "C"}[
                    nombre_lower
                ]
                last_header_codigo = None  # reset al cambiar seccion
            continue

        # Filtrar lineas de meta del archivo
        if (
            "miles de soles" in nombre_lower
            or nombre_lower.startswith("al ")
            or nombre_lower.startswith("(")
        ):
            continue

        nombre_canonico = nombre_raw.strip()
        es_header = nombre_canonico.upper() == nombre_canonico

        # Determinar codigo + nivel + parent
        if es_header:
            # Cuenta de cabecera (L2 balance / L1 resultados)
            top_key = current_section_prefix or "X"
            section_counters[top_key] = section_counters.get(top_key, 0) + 1
            n_top = section_counters[top_key]
            if tipo_estado == "balance":
                codigo = f"{top_key}{n_top}"
                parent_codigo = top_key
                nivel = 2
            else:
                # Resultados: codigos son numeros enteros (1, 2, 3, ...)
                codigo = str(n_top)
                parent_codigo = None
                nivel = 1
            last_header_codigo = codigo
        else:
            # Cuenta hija del ultimo header visto
            if not last_header_codigo:
                continue
            child_counters[last_header_codigo] = child_counters.get(last_header_codigo, 0) + 1
            codigo = f"{last_header_codigo}.{child_counters[last_header_codigo]}"
            parent_codigo = last_header_codigo
            nivel = 3 if tipo_estado == "balance" else 2

        # aplica_a: grupos donde la celda NO esta vacia en esta fila
        aplica_a = tuple(_COL_TO_GRUPO[c] for c in sorted(cells_per_col.keys()))

        orden += 1
        cuentas.append(
            CuentaCanonica(
                codigo=codigo,
                nombre=nombre_canonico,
                tipo_estado=tipo_estado,
                nivel=nivel,
                parent_codigo=parent_codigo,
                orden=orden,
                aplica_a=aplica_a,
            )
        )

    return cuentas


def _looks_like_datetime(s: str) -> bool:
    """True si el string parece una fecha/datetime serializada."""
    s = s.strip()
    if not s or len(s) < 8:
        return False
    # 2018-05-31 00:00:00 / 2018-05-31
    return bool(s[:4].isdigit() and len(s) >= 10 and s[4] == "-" and s[7] == "-")


def _initial_section_prefix(tipo_estado: str) -> str:
    return "A" if tipo_estado == "balance" else ""


def write_seeds(
    cuentas_by_tipo: dict[str, list[CuentaCanonica]],
    *,
    out_dir: Path,
) -> dict[str, Path]:
    """Escribe seeds JSON listos para cargarse en dim_cuenta."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for tipo, cuentas in cuentas_by_tipo.items():
        path = out_dir / f"cuentas_{tipo}.json"
        data = [
            {
                "codigo": c.codigo,
                "nombre": c.nombre,
                "tipo_estado": c.tipo_estado,
                "nivel": c.nivel,
                "parent_codigo": c.parent_codigo,
                "orden": c.orden,
                "aplica_a": list(c.aplica_a),
            }
            for c in cuentas
        ]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        paths[tipo] = path
    return paths
