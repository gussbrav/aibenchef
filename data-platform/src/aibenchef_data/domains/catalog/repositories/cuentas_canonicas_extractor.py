"""Extractor del plan canonico de cuentas SBS desde el archivo BASE EE.FF..xlsx.

`BASE EE.FF..xlsx` tiene en la **fila 0** de cada hoja BG y ER los nombres de
las columnas con codigo regulatorio SBS embebido. Ejemplo de col8 en BG:
"(A1) DISPONIBLE". Esa fila 0 es la cabecera canonica unificada que Gus armo
y que define el plan de cuentas que TODO el sistema debe respetar.

A diferencia del extractor anterior que inferia jerarquia de mayusculas, este
deriva la jerarquia del codigo mismo: (A1.1) -> padre (A1).
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from aibenchef_data.domains.parsing import XlsSheet, read_xls
from aibenchef_data.domains.shared import NotFoundError, ValidationError, get_logger

from ..cuenta import Cuenta, TipoEstado, derive_nivel, derive_parent, parse_label

log = get_logger(__name__)


# Columnas dimensionales en BASE EE.FF..xlsx (no son cuentas).
# Las columnas de cuentas empiezan despues.
_DIMENSION_HEADERS = {
    "code",
    "mes",
    "tipo entidad",
    "microfinan.",
    "microfinan",
    "nacional",
    "empresa sbs",
    "nomb_correg",
    "moneda",
}


def extract_from_base_eeff(
    base_eeff_path: Path,
    *,
    bg_sheet_name: str = "BG",
    er_sheet_name: str = "ER",
) -> dict[str, list[Cuenta]]:
    """Extrae cuentas canonicas leyendo la fila 0 de las hojas BG y ER del BASE."""
    if not base_eeff_path.exists():
        raise NotFoundError(f"No existe: {base_eeff_path}")

    log.info("extract.start", path=str(base_eeff_path))
    sheets = read_xls(base_eeff_path)
    by_name = {s.name.upper(): s for s in sheets}

    if bg_sheet_name.upper() not in by_name:
        raise ValidationError(
            f"Hoja '{bg_sheet_name}' no encontrada",
            context={"hojas_disponibles": [s.name for s in sheets]},
        )
    if er_sheet_name.upper() not in by_name:
        raise ValidationError(
            f"Hoja '{er_sheet_name}' no encontrada",
            context={"hojas_disponibles": [s.name for s in sheets]},
        )

    cuentas_balance = _extract_from_header_row(by_name[bg_sheet_name.upper()], TipoEstado.BALANCE)
    cuentas_resultados = _extract_from_header_row(
        by_name[er_sheet_name.upper()], TipoEstado.RESULTADOS
    )

    log.info(
        "extract.done",
        balance=len(cuentas_balance),
        resultados=len(cuentas_resultados),
    )

    return {
        "balance": cuentas_balance,
        "resultados": cuentas_resultados,
    }


def _extract_from_header_row(sheet: XlsSheet, tipo: TipoEstado) -> list[Cuenta]:
    """Procesa la fila 0 de la hoja y devuelve las cuentas con codigos reales."""
    if sheet.n_rows == 0:
        return []

    header_row = sheet.row(0)
    cuentas: list[Cuenta] = []
    orden = 0

    for col_idx, raw in enumerate(header_row):
        if raw is None:
            continue
        label = str(raw).strip()
        if not label:
            continue

        # Skip dimension columns.
        if label.lower() in _DIMENSION_HEADERS:
            continue

        codigo, nombre = parse_label(label)
        if not codigo:
            # Cuenta sin codigo regulatorio explicito -> skip y log.
            log.debug(
                "extract.skip_no_code",
                tipo=tipo.value,
                col=col_idx,
                label=label,
            )
            continue

        cuentas.append(
            Cuenta(
                codigo=codigo,
                nombre=nombre or codigo,
                tipo_estado=tipo,
                nivel=derive_nivel(codigo),
                parent_codigo=derive_parent(codigo),
                orden=orden + 1,
            )
        )
        orden += 1

    # Garantizar que cada parent_codigo referenciado exista en la lista; si
    # falta el padre, lo agregamos como cuenta sintetica nivel inferior.
    cuentas = _ensure_parents(cuentas, tipo)
    return cuentas


def _ensure_parents(cuentas: list[Cuenta], tipo: TipoEstado) -> list[Cuenta]:
    """Si una cuenta hija referencia un padre que no esta en la lista, lo agregamos."""
    codigos = {c.codigo for c in cuentas}
    extras: list[Cuenta] = []
    next_orden = max((c.orden for c in cuentas), default=0) + 1

    for c in cuentas:
        if c.parent_codigo and c.parent_codigo not in codigos:
            extras.append(
                Cuenta(
                    codigo=c.parent_codigo,
                    nombre=c.parent_codigo,
                    tipo_estado=tipo,
                    nivel=derive_nivel(c.parent_codigo),
                    parent_codigo=derive_parent(c.parent_codigo),
                    orden=next_orden,
                )
            )
            codigos.add(c.parent_codigo)
            next_orden += 1

    return cuentas + extras


def write_seeds(
    seeds: dict[str, list[Cuenta]],
    *,
    out_dir: Path,
) -> dict[str, Path]:
    """Escribe cada categoria a un JSON en out_dir/cuentas_{categoria}.json."""
    import json

    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for categoria, items in seeds.items():
        p = out_dir / f"cuentas_{categoria}.json"
        serializable = [_to_dict(c) for c in items]
        p.write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")
        paths[categoria] = p
    return paths


def _to_dict(c: Cuenta) -> dict:
    d = asdict(c)
    d["tipo_estado"] = c.tipo_estado.value
    d["aplica_a"] = list(c.aplica_a)
    return d
