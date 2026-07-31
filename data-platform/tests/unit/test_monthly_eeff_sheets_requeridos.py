"""Unit tests para el guard "ambos sheets requeridos" del MonthlyEeffImporter.

Reproduce el incidente C-4103-my2026.xls (jul-2026): el archivo SBS bajo
truncado y contenia solo el sheet 'balance', sin 'resultados'. El importer
lo procesaba sin excepcion, dejando el peer group entero sin ER.

Ahora import_file falla explicito con ValidationError si falta alguno de
los dos sheets. El wrapper _import_file_with_audit lo marca como 'error'.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
    MonthlyEeffImporter,
)
from aibenchef_data.domains.parsing.services.xls_reader import XlsSheet
from aibenchef_data.domains.shared import ValidationError


def _make_sheet(name: str) -> XlsSheet:
    """Crea un XlsSheet con contenido minimo que dispara la clasificacion."""
    # El clasificador mira nombre_lower + primeras filas. Un nombre que
    # empieza con 'bg_' o 'gyp_' es suficiente para clasificar.
    return XlsSheet(name=name, n_rows=1, n_cols=1, rows=[[""]])


@pytest.mark.asyncio
async def test_import_file_falla_si_falta_sheet_de_resultados():
    """Reproduce el bug real: .xls con solo BG y sin ER debe romper."""
    importer = MonthlyEeffImporter(conn=None, batch_size=100)  # type: ignore[arg-type]

    with (
        patch(
            "aibenchef_data.domains.loading.services.monthly_eeff_importer.read_xls",
            return_value=[_make_sheet("bg_ed")],
        ),
        pytest.raises(ValidationError, match="'resultados'"),
    ):
        await importer.import_file(
            Path("/tmp/C-4103-my2026.xls"),
            tipo_entidad="EDPYMES",
        )


@pytest.mark.asyncio
async def test_import_file_falla_si_falta_sheet_de_balance():
    """Simetrico: si viene solo el sheet de resultados sin balance, tambien rompe."""
    importer = MonthlyEeffImporter(conn=None, batch_size=100)  # type: ignore[arg-type]

    with (
        patch(
            "aibenchef_data.domains.loading.services.monthly_eeff_importer.read_xls",
            return_value=[_make_sheet("gyp_ed")],
        ),
        pytest.raises(ValidationError, match="'balance'"),
    ):
        await importer.import_file(
            Path("/tmp/C-9999-xx2026.xls"),
            tipo_entidad="EDPYMES",
        )


@pytest.mark.asyncio
async def test_import_file_falla_si_no_hay_ningun_sheet_conocido():
    """Comportamiento previo (V025): sheets no clasificables tambien fallan."""
    importer = MonthlyEeffImporter(conn=None, batch_size=100)  # type: ignore[arg-type]

    with (
        patch(
            "aibenchef_data.domains.loading.services.monthly_eeff_importer.read_xls",
            return_value=[_make_sheet("Sheet1"), _make_sheet("Hoja2")],
        ),
        pytest.raises(ValidationError, match="No se identificaron hojas"),
    ):
        await importer.import_file(
            Path("/tmp/random.xls"),
            tipo_entidad="EDPYMES",
        )
