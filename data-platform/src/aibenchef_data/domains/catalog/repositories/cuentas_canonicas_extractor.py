"""Extractor del plan canonico de cuentas SBS desde los CONSOLIDADO de Gus.

Lee los archivos:
- CONSOLIDADO BALANCE SBS.xlsx (Sheet 'BG')
- CONSOLIDADO GYP SBS.xlsx (Sheet 'ER')
- CABECERAS DE PRINCIPALES INDICADORES SBS.xlsx (Sheet 'CONSOLIDADO')

Y produce un JSON seed con las cuentas canonicas que el parser EEFF debe
respetar y `dw.dim_cuenta` debe contener.

Heuristica:
- Cuentas con nombre en MAYUSCULAS y >= 4 chars y sin lowercase = PADRES (nivel 1).
- Cuentas con nombre en mixto (al menos un lowercase) bajo un padre = HIJAS (nivel 2).
- Filas vacias se ignoran.
- En el archivo de indicadores, la col0 'CABECERA' es la version canonica;
  las columnas siguientes (BANCA, FINANCIERAS, CMACS, CRACS, EDPYMES) indican
  qué grupos publican esa cuenta -> se transforma en `aplica_a`.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict
from pathlib import Path

from aibenchef_data.domains.parsing import XlsSheet, read_xls
from aibenchef_data.domains.shared import NotFoundError, get_logger

from ..cuenta import Cuenta, TipoEstado
from ..enums import Grupo

log = get_logger(__name__)


# ============================================================================
# CONSOLIDADO BALANCE
# ============================================================================


def extract_balance(path: Path) -> list[Cuenta]:
    """Extrae las cuentas del Balance General desde 'CONSOLIDADO BALANCE SBS.xlsx'."""
    sheet = _find_sheet(path, "BG")
    return _extract_jerarquia(
        sheet,
        tipo=TipoEstado.BALANCE,
        codigo_prefix="BG",
        # En BG las columnas son: col0=cabecera, col1=BANCOS, col2=CAJAS,
        # col3=CRACS, col4=EDPYMES. FINANCIERAS no esta en este archivo
        # (probablemente porque el plan FIN es identico a BANCOS).
        aplica_cols={
            1: Grupo.BANCA_MULTIPLE,
            2: Grupo.CMAC,
            3: Grupo.CRAC,
            4: Grupo.EDPYME,
        },
    )


# ============================================================================
# CONSOLIDADO GYP (ER)
# ============================================================================


def extract_resultados(path: Path) -> list[Cuenta]:
    """Extrae las cuentas del Estado de Resultados desde 'CONSOLIDADO GYP SBS.xlsx'."""
    sheet = _find_sheet(path, "ER")
    return _extract_jerarquia(
        sheet,
        tipo=TipoEstado.RESULTADOS,
        codigo_prefix="ER",
        # ER: col0=BANCOS, col1=FINANCIERAS, col2=CAJAS, col3=CRACS, col4=EDPYMES
        aplica_cols={
            0: Grupo.BANCA_MULTIPLE,
            1: Grupo.FINANCIERA,
            2: Grupo.CMAC,
            3: Grupo.CRAC,
            4: Grupo.EDPYME,
        },
        # Como col0 es BANCOS (no la cabecera canonica), la cabecera canonica
        # la tomamos del primer valor no-vacio en cada fila.
        cabecera_col=None,
    )


# ============================================================================
# CABECERAS INDICADORES
# ============================================================================


def extract_indicadores(path: Path) -> list[Cuenta]:
    """Extrae los indicadores canonicos."""
    sheet = _find_sheet(path, "CONSOLIDADO")
    return _extract_jerarquia(
        sheet,
        tipo=TipoEstado.INDICADOR,
        codigo_prefix="IND",
        aplica_cols={
            1: Grupo.BANCA_MULTIPLE,
            2: Grupo.FINANCIERA,
            3: Grupo.CMAC,
            4: Grupo.CRAC,
            5: Grupo.EDPYME,
        },
        cabecera_col=0,
        is_indicadores=True,
    )


# ============================================================================
# Helpers
# ============================================================================


def _find_sheet(path: Path, name_hint: str) -> XlsSheet:
    if not path.exists():
        raise NotFoundError(f"Archivo no existe: {path}")
    sheets = read_xls(path)
    for s in sheets:
        if s.name.upper() == name_hint.upper():
            return s
    # Fallback: usar la primera hoja
    if sheets:
        log.warning(
            "sheet.fallback_to_first",
            file=path.name,
            wanted=name_hint,
            actual=sheets[0].name,
        )
        return sheets[0]
    raise NotFoundError(f"Sin hojas en {path.name}")


def _extract_jerarquia(
    sheet: XlsSheet,
    *,
    tipo: TipoEstado,
    codigo_prefix: str,
    aplica_cols: dict[int, Grupo],
    cabecera_col: int | None = 0,
    is_indicadores: bool = False,
) -> list[Cuenta]:
    """Genera la lista de Cuentas leyendo filas de la hoja consolidada."""
    cuentas: list[Cuenta] = []
    parent_codigo: str | None = None
    current_categoria: str | None = None
    orden = 0
    seen: set[str] = set()

    for r in range(sheet.n_rows):
        cabecera = _row_canonical_name(sheet, r, cabecera_col)
        if not cabecera:
            continue

        # Determinar qué grupos publican esta cuenta. Si la col del grupo
        # tiene un valor (no None y no vacio), se considera que aplica.
        aplica_a = tuple(
            g.value
            for col_idx, g in aplica_cols.items()
            if _cell_str(sheet.cell(r, col_idx))
        )
        # Si ningun grupo publica, igual lo incluimos como "canonico" pero
        # con aplica_a vacio.

        es_padre = _es_padre(cabecera)

        if is_indicadores and es_padre:
            current_categoria = cabecera

        codigo = f"{codigo_prefix}_{orden + 1:04d}"
        if codigo in seen:
            continue
        seen.add(codigo)

        cuenta = Cuenta(
            codigo=codigo,
            nombre=cabecera,
            tipo_estado=tipo,
            nivel=1 if es_padre else 2,
            parent_codigo=None if es_padre else parent_codigo,
            orden=orden + 1,
            aplica_a=aplica_a,
            categoria=current_categoria if is_indicadores else None,
        )
        cuentas.append(cuenta)
        orden += 1

        if es_padre:
            parent_codigo = codigo

    return cuentas


def _row_canonical_name(
    sheet: XlsSheet, row_idx: int, cabecera_col: int | None
) -> str | None:
    """Devuelve el nombre canonico de la fila.

    Si cabecera_col se especifica, lee esa columna. Si es None, devuelve el
    primer valor no-vacio de la fila (clasico de CONSOLIDADO GYP donde col0
    es BANCOS pero el texto se repite identico en todas las cols).
    """
    if cabecera_col is not None:
        return _cell_str(sheet.cell(row_idx, cabecera_col))
    for c in range(min(sheet.n_cols, 8)):
        v = _cell_str(sheet.cell(row_idx, c))
        if v:
            return v
    return None


def _cell_str(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _es_padre(nombre: str) -> bool:
    """Heuristica: nombres todo-en-mayusculas (excluyendo digitos y signos) son padres."""
    letras = [c for c in nombre if c.isalpha()]
    if len(letras) < 3:
        return False
    return all(c.isupper() for c in letras)


# ============================================================================
# Bulk: extraer las 3 categorias y devolver dicts JSON-serializables
# ============================================================================


def extract_all(*, knowledge_base_dir: Path) -> dict[str, list[dict]]:
    """Procesa los 3 archivos canonicos y devuelve los seeds listos para JSON."""
    balance_path = knowledge_base_dir / "CONSOLIDADO BALANCE SBS.xlsx"
    gyp_path = knowledge_base_dir / "CONSOLIDADO GYP SBS.xlsx"
    indicadores_path = knowledge_base_dir / "CABECERAS DE PRINCIPALES INDICADORES SBS.xlsx"

    cuentas_balance = extract_balance(balance_path)
    cuentas_resultados = extract_resultados(gyp_path)
    cuentas_indicadores = extract_indicadores(indicadores_path)

    return {
        "balance": [_to_dict(c) for c in cuentas_balance],
        "resultados": [_to_dict(c) for c in cuentas_resultados],
        "indicadores": [_to_dict(c) for c in cuentas_indicadores],
    }


def _to_dict(c: Cuenta) -> dict:
    d = asdict(c)
    # tipo_estado es StrEnum -> serializar como str
    d["tipo_estado"] = c.tipo_estado.value
    # aplica_a es tuple -> lista
    d["aplica_a"] = list(c.aplica_a)
    return d


def write_seeds(
    seeds: dict[str, list[dict]],
    *,
    out_dir: Path,
) -> dict[str, Path]:
    """Escribe cada categoria a un JSON en out_dir/cuentas_{categoria}.json."""
    import json

    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for categoria, items in seeds.items():
        p = out_dir / f"cuentas_{categoria}.json"
        p.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        paths[categoria] = p
    return paths
