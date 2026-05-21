"""Tests de cuenta.py — codigos regulatorios SBS y derivacion de jerarquia."""

import pytest

from aibenchef_data.domains.catalog.cuenta import derive_nivel, derive_parent, parse_label


class TestParseLabel:
    def test_codigo_simple(self):
        assert parse_label("(A1) DISPONIBLE") == ("A1", "DISPONIBLE")

    def test_codigo_con_punto(self):
        assert parse_label("(A1.1) Caja") == ("A1.1", "Caja")
        assert parse_label("(A1.2) Bancos y Corresponsales") == (
            "A1.2",
            "Bancos y Corresponsales",
        )

    def test_codigo_resultados(self):
        assert parse_label("(1) INGRESOS FINANCIEROS") == ("1", "INGRESOS FINANCIEROS")
        assert parse_label("(1.3) Inversiones") == ("1.3", "Inversiones")

    def test_codigo_anidado_profundo(self):
        assert parse_label("(B2.4.1) Sub-sub-cuenta") == ("B2.4.1", "Sub-sub-cuenta")

    def test_sin_codigo(self):
        assert parse_label("Caja Solamente") == (None, "Caja Solamente")
        assert parse_label("MES") == (None, "MES")

    def test_empty(self):
        assert parse_label("") == (None, "")


class TestDeriveParent:
    def test_un_nivel(self):
        assert derive_parent("A1.1") == "A1"
        assert derive_parent("A1.1.2") == "A1.1"

    def test_letra_numero(self):
        assert derive_parent("A1") == "A"
        assert derive_parent("B23") == "B"

    def test_solo_letra(self):
        assert derive_parent("A") is None
        assert derive_parent("B") is None

    def test_solo_numero(self):
        assert derive_parent("1") is None
        assert derive_parent("12") is None

    def test_numero_con_punto(self):
        assert derive_parent("1.2") == "1"
        assert derive_parent("1.2.3") == "1.2"


class TestDeriveNivel:
    def test_letra_sola(self):
        assert derive_nivel("A") == 1
        assert derive_nivel("B") == 1

    def test_letra_numero(self):
        assert derive_nivel("A1") == 2
        assert derive_nivel("B23") == 2

    def test_letra_numero_punto(self):
        assert derive_nivel("A1.1") == 3
        assert derive_nivel("A1.1.2") == 4

    def test_solo_numero(self):
        assert derive_nivel("1") == 1
        assert derive_nivel("12") == 1

    def test_numero_punto(self):
        assert derive_nivel("1.2") == 2
        assert derive_nivel("1.2.3") == 3
