"""Tests para MonthlyEeffImporter — sincronia orden vs cabecera_maestra."""

from __future__ import annotations

from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
    _is_annotation_or_footnote_extra,
)


class TestIsAnnotationOrFootnoteExtra:
    """REGRESION issue #15: filas EXTRA fuera de cabecera_maestra
    causaban offset acumulado en orden, mal-asignando codigos contables
    (ej. Mibanco Jun 2019: TOTAL PASIVO terminaba en C1 = Capital Social).
    """

    def test_resolucion_sbs_un_asterisco(self):
        """B-2201-jn2019.xls: '* Mediante Resolución SBS N° 1286-2019...'"""
        assert _is_annotation_or_footnote_extra(
            "* Mediante Resolución SBS N° 1286-2019 (08/05/2019)..."
        )

    def test_resolucion_sbs_doble_asterisco(self):
        assert _is_annotation_or_footnote_extra("** Mediante Resolución SBS N° 4358-2015...")

    def test_asterisco_con_espacio(self):
        assert _is_annotation_or_footnote_extra("*   Algun texto suelto")

    def test_footnote_numerada_uno(self):
        """SBS publica notas como '1/ Incluye intereses devengados...'"""
        assert _is_annotation_or_footnote_extra("1/ Incluye intereses devengados")

    def test_footnote_numerada_doble_digito(self):
        assert _is_annotation_or_footnote_extra("12/ Las cifras al cierre")

    def test_cuenta_normal_no_es_anotacion(self):
        """Filas legitimas de cuentas no deben detectarse como extra."""
        assert not _is_annotation_or_footnote_extra("CAPITAL SOCIAL")
        assert not _is_annotation_or_footnote_extra("Total Pasivo")
        assert not _is_annotation_or_footnote_extra("Disponible")

    def test_string_vacio(self):
        assert not _is_annotation_or_footnote_extra("")
        assert not _is_annotation_or_footnote_extra("   ")

    def test_numero_sin_barra_no_es_footnote(self):
        """'1 Disponible' (sin /) es una cuenta jerarquica, NO footnote."""
        assert not _is_annotation_or_footnote_extra("1 Disponible")
        assert not _is_annotation_or_footnote_extra("11 Caja")

    def test_balance_general_no_es_extra(self):
        """'Balance General por Empresa Bancaria' SI esta en cabecera_maestra
        con codigo=NULL — no debe filtrarse por esta funcion, se maneja por
        position_lookup."""
        assert not _is_annotation_or_footnote_extra("Balance General por Empresa Bancaria")
