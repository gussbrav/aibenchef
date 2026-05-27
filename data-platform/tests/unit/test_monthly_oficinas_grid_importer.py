"""Tests para MonthlyOficinasGridImporter (grid empresa x departamento)."""

from __future__ import annotations

from pathlib import Path

from aibenchef_data.domains.loading.services.monthly_oficinas_grid_importer import (
    _detect_departamentos,
    _detect_entidades_transpuesto,
    _detect_layout,
    _detect_tipo_entidad,
    _extract_fecha,
    _extract_fecha_from_filename,
    _find_header_row,
)
from aibenchef_data.domains.parsing.services.xls_reader import XlsSheet


def _sheet(rows: list[list]) -> XlsSheet:
    if not rows:
        return XlsSheet(name="t", n_rows=0, n_cols=0, rows=[])
    n_cols = max(len(r) for r in rows)
    padded = [r + [None] * (n_cols - len(r)) for r in rows]
    return XlsSheet(name="t", n_rows=len(rows), n_cols=n_cols, rows=padded)


class TestDetectLayout:
    """REGRESION issue #4: layouts pre-2015 transpuesto + asterisco en header."""

    def test_layout_horizontal_moderno(self):
        sheet = _sheet(
            [
                ["Distribucion de Oficinas"],
                [None],
                [None],
                [None],
                [None],
                ["Empresas", "Amazonas", "Ancash"],
                [None],
                ["B. Continental", 5, 3],
            ]
        )
        assert _detect_layout(sheet) == ("horizontal", 5)

    def test_layout_horizontal_con_asterisco(self):
        """FINANCIERA 2022-11/12 usa 'Empresas*' con asterisco de nota."""
        sheet = _sheet(
            [
                ["Distribucion"],
                [None],
                [None],
                [None],
                [None],
                ["Empresas*", "Amazonas", "Ancash"],
                [None],
                ["Crediscotia", 5, 3],
            ]
        )
        result = _detect_layout(sheet)
        assert result == ("horizontal", 5)

    def test_layout_transpuesto_pre_2015(self):
        """FINANCIERA 2009-2015: col 0 = 'Departamento', entidades como cols."""
        sheet = _sheet(
            [
                [None],
                [None],
                ["Distribucion de Oficinas"],
                ["Al 31 de Enero de 2009"],
                [None],
                ["Departamento", "Crediscotia", "Edyficar", "TFC"],
                ["Ancash", 2, 8, 2],
                ["Arequipa", 6, 5, 1],
            ]
        )
        assert _detect_layout(sheet) == ("transpuesto", 5)

    def test_layout_no_detectable(self):
        sheet = _sheet([["foo", "bar"]] * 8)
        assert _detect_layout(sheet) is None


class TestDetectEntidadesTranspuesto:
    def test_entidades_excluyendo_total(self):
        sheet = _sheet([["Departamento", "Crediscotia", "Edyficar", "Total"]])
        entidades = _detect_entidades_transpuesto(sheet, 0)
        assert entidades == [("Crediscotia", 1), ("Edyficar", 2)]


class TestFindHeaderRow:
    def test_header_en_row_3_crac(self):
        sheet = _sheet(
            [
                ["Distribucion de Oficinas"],
                [45000],
                [None],
                ["Empresas", "Amazonas", "Ancash", "Apurimac"],
                [None],
                ["CRAC LOS ANDES", 2, 0, 2],
            ]
        )
        assert _find_header_row(sheet) == 3

    def test_header_en_row_5_bancos(self):
        sheet = _sheet(
            [
                [None],
                ["Distribucion de Oficinas"],
                ["2024-12-31"],
                [None],
                [None],
                ["Empresas", "Amazonas", "Ancash"],
                [None],
                ["B. Continental", 5, 3],
            ]
        )
        assert _find_header_row(sheet) == 5

    def test_no_header_retorna_none(self):
        sheet = _sheet([["foo", "bar"]] * 8)
        assert _find_header_row(sheet) is None

    def test_no_acepta_empresas_con_numero_en_col_1(self):
        """REGRESION: si col 1 es numero, no es la fila de header."""
        sheet = _sheet(
            [
                ["Empresas", 100, 200, 300],  # esto NO es header valido
                [None],
                ["Empresas", "Amazonas", "Ancash"],  # este SI
            ]
        )
        assert _find_header_row(sheet) == 2


class TestDetectDepartamentos:
    def test_lista_deptos_excluyendo_total(self):
        sheet = _sheet(
            [
                ["Empresas", "Amazonas", "Ancash", "Lima", "Total"],
            ]
        )
        deptos = _detect_departamentos(sheet, 0)
        assert deptos == [("Amazonas", 1), ("Ancash", 2), ("Lima", 3)]
        # "Total" debe ser excluido
        assert not any(d[0] == "Total" for d in deptos)

    def test_excluye_total_con_variantes(self):
        sheet = _sheet([["Empresas", "Lima", "Total Nacional"]])
        deptos = _detect_departamentos(sheet, 0)
        assert deptos == [("Lima", 1)]


class TestDetectTipoEntidad:
    def test_bancos(self):
        p = Path("/tmp/local-data/raw/banca_multiple/oficinas/2024/12/B-2303-di2024.xls")
        assert _detect_tipo_entidad(p) == "BANCOS"

    def test_crac(self):
        p = Path("/tmp/local-data/raw/crac/oficinas/2024/12/C-2201-di2024.xls")
        assert _detect_tipo_entidad(p) == "CRAC"

    def test_edpyme(self):
        p = Path("/tmp/local-data/raw/edpyme/oficinas/2024/12/C-4205-di2024.xls")
        assert _detect_tipo_entidad(p) == "EDPYMES"

    def test_desconocido(self):
        assert _detect_tipo_entidad(Path("/tmp/random/path.xls")) == "DESCONOCIDO"


class TestExtractFecha:
    def test_iso_string(self):
        sheet = _sheet([[None], [None], ["2024-12-31 00:00:00"]])
        result = _extract_fecha(sheet)
        assert result is not None
        assert result[0] == 202412

    def test_serial_excel(self):
        # 45657 = 2024-12-31
        sheet = _sheet([[None], [45657]])
        result = _extract_fecha(sheet)
        assert result is not None
        assert result[0] == 202412

    def test_filename_fallback(self):
        assert _extract_fecha_from_filename(Path("/tmp/B-2303-di2024.xls")) == (
            202412,
            "2024-12-31",
        )
        assert _extract_fecha_from_filename(Path("/tmp/C-1201-jn2020.xls")) == (
            202006,
            "2020-06-30",
        )
