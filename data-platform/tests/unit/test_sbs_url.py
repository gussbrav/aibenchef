"""Tests del SbsUrlBuilder."""

import pytest

from aibenchef_data.domains.catalog import Grupo, Periodo, SbsUrlBuilder, Topico
from aibenchef_data.domains.shared import NotFoundError


class TestSbsUrlBuilder:
    def test_cmac_eeff_marzo_2024(self):
        """Caso canonico: replica el .bat legacy."""
        ref = SbsUrlBuilder.build(Grupo.CMAC, Topico.EEFF, Periodo(2024, 3))
        assert ref.filename == "C-1101-ma2024.xls"
        assert ref.url() == (
            "https://intranet2.sbs.gob.pe/estadistica/financiera/"
            "2024/Marzo/C-1101-ma2024.xls"
        )

    def test_banca_multiple_indicadores(self):
        ref = SbsUrlBuilder.build(Grupo.BANCA_MULTIPLE, Topico.INDICADORES, Periodo(2020, 1))
        assert ref.filename == "B-2401-en2020.xls"

    def test_clientes_credito_banca_multiple_uses_6_digit_code(self):
        ref = SbsUrlBuilder.build(
            Grupo.BANCA_MULTIPLE, Topico.CLIENTES_CREDITO, Periodo(2024, 3)
        )
        assert ref.filename == "B-230803-ma2024.xls"

    def test_edpyme_no_tiene_depositos(self):
        assert not SbsUrlBuilder.is_published(Grupo.EDPYME, Topico.DEPOSITOS)
        with pytest.raises(NotFoundError):
            SbsUrlBuilder.build(Grupo.EDPYME, Topico.DEPOSITOS, Periodo(2024, 3))

    def test_edpyme_no_tiene_clientes_ahorro(self):
        assert not SbsUrlBuilder.is_published(Grupo.EDPYME, Topico.CLIENTES_AHORRO)

    def test_setiembre_no_septiembre(self):
        """SBS escribe Setiembre con T, no Septiembre."""
        ref = SbsUrlBuilder.build(Grupo.CMAC, Topico.EEFF, Periodo(2023, 9))
        assert ref.filename == "C-1101-se2023.xls"
        assert "Setiembre" in ref.url()

    def test_all_for_periodo_default_devuelve_48(self):
        refs = SbsUrlBuilder.all_for_periodo(Periodo(2024, 3))
        # 10 (BM) + 10 (Fin) + 10 (CMAC) + 10 (CRAC) + 8 (EDPYME, sin 2) = 48
        assert len(refs) == 48

    def test_all_for_periodo_solo_cmac(self):
        refs = SbsUrlBuilder.all_for_periodo(Periodo(2024, 3), grupos=[Grupo.CMAC])
        assert len(refs) == 10
        assert all(r.grupo == Grupo.CMAC for r in refs)

    def test_all_for_periodo_solo_eeff(self):
        refs = SbsUrlBuilder.all_for_periodo(Periodo(2024, 3), topicos=[Topico.EEFF])
        assert len(refs) == 5  # un EEFF por grupo
        assert all(r.topico == Topico.EEFF for r in refs)
