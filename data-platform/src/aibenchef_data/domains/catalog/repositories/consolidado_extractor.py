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
    parent_stack: list[str] = []  # pila de parents segun nivel actual
    # Para detectar nivel: las cabeceras MAYUSCULAS son top de seccion, las
    # mixed-case son hijas. En BANCOS hay indentacion explicita "   Caja".

    # Numerador autoincremental por seccion para asignar codigos.
    section_counters: dict[str, int] = {}  # ej {"A": 9, "B": 5}

    for row_idx in range(0, sheet.n_rows):
        # Recoger texto de cada columna A-E
        cells_per_col: dict[int, str] = {}
        for col, _ in _COL_TO_GRUPO.items():
            v = sheet.cell(row_idx, col)
            if v is None:
                continue
            s = str(v).strip()
            if s:
                cells_per_col[col] = s

        if not cells_per_col:
            continue

        # Tomar el nombre de la primera celda no vacia (BANCOS first)
        nombre_raw = next(iter(cells_per_col.values()))
        nombre_lower = nombre_raw.strip().lower()

        # Filtrar headers de columna y marcadores de seccion
        if nombre_lower in header_terms:
            if tipo_estado == "balance" and nombre_lower in ("activo", "pasivo", "patrimonio"):
                current_section_prefix = {"activo": "A", "pasivo": "B", "patrimonio": "C"}[
                    nombre_lower
                ]
                parent_stack = []
            continue

        # Filtrar lineas de fecha/titulo
        if "miles de soles" in nombre_lower or "al " in nombre_lower[:4]:
            continue

        nombre_canonico = nombre_raw.strip()
        # Detectar nivel via mayusculas + indentacion
        es_header = nombre_canonico.upper() == nombre_canonico  # MAYUSCULAS = top de bloque
        indent_spaces = len(nombre_raw) - len(nombre_raw.lstrip())
        # En BANCOS hijos tienen 3 espacios. En CMAC no hay indent visible.
        # Si MAYUSCULAS, nivel = 2 (balance) o 1 (resultados); sino, nivel = nivel_padre + 1
        if es_header:
            nivel = 2 if tipo_estado == "balance" else 1
        elif indent_spaces >= 3:
            nivel = 3 if tipo_estado == "balance" else 2
        else:
            # CMAC / heuristica: si hay parent_stack y la cuenta es hijo del header actual, nivel++
            nivel = (parent_stack and len(parent_stack) + 1) or (
                2 if tipo_estado == "balance" else 1
            )

        # Determinar codigo segun la seccion y orden.
        # Strategy simplificada: contador por seccion, sub-indices para hijos.
        if es_header:
            # Nueva cuenta L2 (balance) o L1 (resultados): incrementa contador top
            top_key = current_section_prefix or "X"
            section_counters[top_key] = section_counters.get(top_key, 0) + 1
            codigo = (
                f"{top_key}{section_counters[top_key]}"
                if top_key
                else str(section_counters[top_key])
            )
            parent_codigo = top_key if top_key in ("A", "B", "C") else None
            parent_stack = [codigo]
        else:
            # Hijo: codigo = parent + '.' + child_idx
            if not parent_stack:
                # Sin parent contexto, skip
                continue
            parent_codigo = parent_stack[-1]
            child_idx_key = f"{parent_codigo}.child"
            section_counters[child_idx_key] = section_counters.get(child_idx_key, 0) + 1
            codigo = f"{parent_codigo}.{section_counters[child_idx_key]}"
            # No agregamos a parent_stack porque solo trackeamos L1/L2 parents

        # Calcular aplica_a: grupos donde NO esta vacio en esa fila
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
