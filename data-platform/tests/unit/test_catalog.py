"""Tests del domain catalog."""

import pytest

from aibenchef_data.domains.catalog import (
    EntidadesCatalog,
    Grupo,
    Periodo,
    Topico,
)
from aibenchef_data.domains.shared import ValidationError


class TestPeriodo:
    def test_from_yyyymm(self):
        p = Periodo.from_yyyymm("202403")
        assert p.anio == 2024
        assert p.mes == 3

    def test_from_yyyymm_int(self):
        p = Periodo.from_yyyymm(202403)
        assert p.anio == 2024
        assert p.mes == 3

    def test_from_yyyymm_invalid(self):
        with pytest.raises(ValidationError):
            Periodo.from_yyyymm("2024")
        with pytest.raises(ValidationError):
            Periodo.from_yyyymm("202413")  # mes 13 invalido
        with pytest.raises(ValidationError):
            Periodo.from_yyyymm("202400")  # mes 0 invalido

    def test_to_int(self):
        assert Periodo(2024, 3).to_int() == 202403
        assert Periodo(2024, 12).to_int() == 202412

    def test_str(self):
        assert str(Periodo(2024, 3)) == "202403"
        assert str(Periodo(2024, 12)) == "202412"

    def test_sbs_suffix(self):
        assert Periodo(2024, 1).sbs_suffix == "en2024"
        assert Periodo(2024, 3).sbs_suffix == "ma2024"
        assert Periodo(2024, 12).sbs_suffix == "di2024"

    def test_cierre(self):
        from datetime import date

        assert Periodo(2024, 2).cierre == date(2024, 2, 29)  # leap year
        assert Periodo(2023, 2).cierre == date(2023, 2, 28)
        assert Periodo(2024, 12).cierre == date(2024, 12, 31)

    def test_next_previous(self):
        assert Periodo(2024, 3).next() == Periodo(2024, 4)
        assert Periodo(2024, 12).next() == Periodo(2025, 1)
        assert Periodo(2024, 3).previous() == Periodo(2024, 2)
        assert Periodo(2024, 1).previous() == Periodo(2023, 12)

    def test_offset(self):
        assert Periodo(2024, 3).offset(12) == Periodo(2025, 3)
        assert Periodo(2024, 3).offset(-6) == Periodo(2023, 9)

    def test_ordering(self):
        assert Periodo(2024, 1) < Periodo(2024, 2)
        assert Periodo(2023, 12) < Periodo(2024, 1)

    def test_immutability(self):
        p = Periodo(2024, 3)
        with pytest.raises(Exception):
            p.anio = 2025  # type: ignore[misc]


class TestEnums:
    def test_grupo_label(self):
        assert Grupo.CMAC.label == "Cajas Municipales (CMAC)"
        assert Grupo.BANCA_MULTIPLE.label == "Banca Multiple"

    def test_topico_label(self):
        assert Topico.EEFF.label == "Estados Financieros"
        assert Topico.INDICADORES.label == "Indicadores Regulatorios"

    def test_grupo_folder_seq(self):
        assert Grupo.BANCA_MULTIPLE.folder_seq == "01"
        assert Grupo.EDPYME.folder_seq == "05"

    def test_topico_folder_seq(self):
        assert Topico.EEFF.folder_seq == "01"
        assert Topico.INDICADORES.folder_seq == "10"


class TestEntidadesCatalog:
    def test_default_loads(self):
        cat = EntidadesCatalog.default()
        assert len(cat) > 40  # tenemos ~50 en el seed

    def test_by_codigo(self):
        cat = EntidadesCatalog.default()
        bcp = cat.by_codigo("2001")
        assert bcp.nombre == "Banco de Credito del Peru"
        assert bcp.grupo == Grupo.BANCA_MULTIPLE

    def test_list_filter_grupo(self):
        cat = EntidadesCatalog.default()
        cmacs = cat.list(grupo=Grupo.CMAC)
        assert all(e.grupo == Grupo.CMAC for e in cmacs)
        assert len(cmacs) >= 10  # al menos 10 CMACs activas
