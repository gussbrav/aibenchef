"""Compara la estructura de un archivo SBS contra dw.cabecera_maestra.

Extracción de la lógica que vivía solo en `aibenchef catalog detectar-cambios`
(que escribía a stdout). Ahora es una función reusable que retorna datos
estructurados — usada por:

- `aibenchef catalog detectar-cambios`: imprime al CLI
- `aibenchef pipeline post-import-check`: persiste en admin.estructura_diffs

Issue #18 (G3 — drift estructural debe persistir y notificar).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg

from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
    _cell_str,
    _detect_layout,
    _normalize,
)
from aibenchef_data.domains.parsing import read_xls

# Mapeo grupo (lo que usa la UI/DB) → subdirectorio en local-data/raw/
GRUPO_TO_DIR: dict[str, str] = {
    "BANCOS": "banca_multiple",
    "FINANCIERAS": "financiera",
    "CMAC": "cmac",
    "CRAC": "crac",
    "EDPYMES": "edpyme",
}

# Markers que NO suman orden (igual lógica que init-maestra y el parser).
_BALANCE_SECTION_MARKERS = frozenset({"activo", "pasivo", "patrimonio", "patrimonio neto"})


@dataclass
class EstructuraDiff:
    """Resumen de un comparison entre un archivo SBS y la cabecera_maestra.

    Una instancia por (periodo, grupo, tipo_estado). Lista para serializar
    a admin.estructura_diffs.payload (jsonb) o mostrar al CLI.
    """

    periodo: int
    grupo: str
    tipo_estado: str  # 'balance' | 'resultados'
    archivo: str  # nombre.xls usado para la comparacion

    # Filas del archivo y la maestra (counts para summary)
    n_filas_archivo: int = 0
    n_filas_maestra: int = 0

    # Discrepancias estructuradas
    renames: list[dict[str, Any]] = field(default_factory=list)
    extras: list[dict[str, Any]] = field(default_factory=list)
    missing: list[dict[str, Any]] = field(default_factory=list)

    @property
    def n_renames(self) -> int:
        return len(self.renames)

    @property
    def n_extras(self) -> int:
        return len(self.extras)

    @property
    def n_missing(self) -> int:
        return len(self.missing)

    @property
    def total_diffs(self) -> int:
        return self.n_renames + self.n_extras + self.n_missing

    @property
    def severity(self) -> str:
        """Heurística de severidad para alertas del dashboard.

        - critical: >5 missing en cuentas core (probablemente rompe ingesta)
        - warning : cualquier extra o rename desconocido (requiere revisión)
        - info    : sin diffs
        """
        if self.n_missing > 5:
            return "critical"
        if self.n_extras > 0 or self.n_renames > 0 or self.n_missing > 0:
            return "warning"
        return "info"

    def to_payload(self) -> dict[str, Any]:
        """Serializa para admin.estructura_diffs.payload (jsonb)."""
        return {
            "renames": self.renames,
            "extras": self.extras,
            "missing": self.missing,
            "metadata": {
                "archivo": self.archivo,
                "n_filas_archivo": self.n_filas_archivo,
                "n_filas_maestra": self.n_filas_maestra,
            },
        }


def compare_periodo_vs_cabecera(
    conn: psycopg.Connection,
    *,
    periodo: int,
    storage_root: Path,
    grupos: list[str] | None = None,
) -> list[EstructuraDiff]:
    """Compara todos los archivos eeff de un periodo contra dw.cabecera_maestra.

    Para cada (grupo, tipo_estado) que tenga archivo en disco y maestra en
    DB, abre el primer xls del directorio y compara filas por orden.

    Args:
        conn: Conexión psycopg (síncrona, ya conectada). Usamos sync porque
            el caller original es síncrono (CLI command).
        periodo: YYYYMM.
        storage_root: Path raíz a local-data/raw/.
        grupos: Filtrar a estos grupos. None = todos.

    Returns:
        Lista de EstructuraDiff, una por (grupo, tipo_estado) analizado.
        No retorna entries para grupos sin archivo en disco.
    """
    anio = periodo // 100
    mes = periodo % 100

    grupos_to_check = grupos or list(GRUPO_TO_DIR.keys())
    diffs: list[EstructuraDiff] = []

    for grupo in grupos_to_check:
        dir_grupo = GRUPO_TO_DIR.get(grupo)
        if not dir_grupo:
            continue

        base = storage_root / dir_grupo / "eeff" / str(anio) / f"{mes:02d}"
        if not base.is_dir():
            continue

        files = sorted(base.glob("*.xls"))
        if not files:
            continue

        f = files[0]
        try:
            sheets = read_xls(f)
        except Exception:
            # Si falla la lectura, lo ignoramos — el import siguiente lo reporta.
            continue

        balance_sheet = next((s for s in sheets if _is_balance_sheet(s)), None)
        resultados_sheet = next((s for s in sheets if _is_resultados_sheet(s)), None)

        for tipo_estado, sheet in (
            ("balance", balance_sheet),
            ("resultados", resultados_sheet),
        ):
            if sheet is None:
                continue
            diff = _compare_sheet_vs_maestra(
                conn=conn,
                sheet=sheet,
                periodo=periodo,
                grupo=grupo,
                tipo_estado=tipo_estado,
                archivo=f.name,
            )
            diffs.append(diff)

    return diffs


def _compare_sheet_vs_maestra(
    *,
    conn: psycopg.Connection,
    sheet,
    periodo: int,
    grupo: str,
    tipo_estado: str,
    archivo: str,
) -> EstructuraDiff:
    """Compara una sheet vs cabecera_maestra para un (grupo, tipo_estado)."""
    layout = _detect_layout(sheet)
    file_rows: list[tuple[int, str, str]] = []  # (orden, nombre_norm, nombre_raw)
    orden = 0
    for r in range(layout.data_start_row, sheet.n_rows):
        nombre_raw = _cell_str(sheet, r, 0)
        if not nombre_raw:
            continue
        nombre_norm = _normalize(nombre_raw)
        if tipo_estado == "balance" and nombre_norm in _BALANCE_SECTION_MARKERS:
            continue
        orden += 1
        file_rows.append((orden, nombre_norm, nombre_raw.strip()))

    # Cargar maestra para el grupo+tipo_estado
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT orden, nombre, codigo
            FROM dw.cabecera_maestra
            WHERE tipo_estado = %s
              AND tipo_entidad = %s
              AND valido_hasta IS NULL
            ORDER BY orden
            """,
            (tipo_estado, grupo),
        )
        maestra_rows = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

    diff = EstructuraDiff(
        periodo=periodo,
        grupo=grupo,
        tipo_estado=tipo_estado,
        archivo=archivo,
        n_filas_archivo=len(file_rows),
        n_filas_maestra=len(maestra_rows),
    )

    file_ordenes = {o for o, _, _ in file_rows}

    for orden, name_norm, name_raw in file_rows:
        if orden not in maestra_rows:
            diff.extras.append({"orden": orden, "archivo": name_raw[:200]})
            continue
        maestra_nombre, maestra_codigo = maestra_rows[orden]
        if _normalize(maestra_nombre) != name_norm:
            diff.renames.append(
                {
                    "orden": orden,
                    "archivo": name_raw[:200],
                    "cabecera": maestra_nombre[:200],
                    "codigo": maestra_codigo,
                }
            )

    for orden, (maestra_nombre, maestra_codigo) in maestra_rows.items():
        if orden not in file_ordenes:
            diff.missing.append(
                {
                    "orden": orden,
                    "cabecera": maestra_nombre[:200],
                    "codigo": maestra_codigo,
                }
            )

    return diff


def _is_balance_sheet(sheet) -> bool:
    """Heurística — mirror de la usada en el comando CLI."""
    name = sheet.name.lower()
    if name.startswith("bg_"):
        return True
    for r in range(0, 4):
        v = sheet.cell(r, 0)
        if v and "balance general" in str(v).lower():
            return True
    return False


def _is_resultados_sheet(sheet) -> bool:
    """Heurística — mirror de la usada en el comando CLI."""
    name = sheet.name.lower()
    if name.startswith(("gyp_", "egyp_", "er_")):
        return True
    for r in range(0, 4):
        v = sheet.cell(r, 0)
        if not v:
            continue
        s = str(v).lower()
        if "estado de ganancias" in s or "estado de resultados" in s:
            return True
    return False
