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


class TestAnnotationPatternsIssue42:
    """REGRESION issue #42: extension de patrones de anotacion SBS detectados
    via auditor F1 v2 sobre 90 muestras 2009-2026 (BANCOS, FINANCIERAS, CMAC,
    CRAC, EDPYMES).

    Estos patrones reemplazan filas que historicamente vivian en cabecera_maestra
    como `codigo=NULL` (V103 los limpia). Pasarlos al detector hace que la
    cabecera sea source-of-truth solo de cuentas reales.
    """

    # --- Excel serial dates como header ---
    def test_excel_serial_date_entero(self):
        """'40543.0' = 2010-12-31 publicado por SBS como header cell type DATE."""
        assert _is_annotation_or_footnote_extra("40543.0")

    def test_excel_serial_date_sin_decimal(self):
        assert _is_annotation_or_footnote_extra("40543")

    def test_excel_serial_date_dos_decimales(self):
        assert _is_annotation_or_footnote_extra("42400.00")

    def test_numero_largo_no_serial_no_anotacion(self):
        """7 digitos+ no es serial date — alguna cuenta podria llevar codigo numerico."""
        assert not _is_annotation_or_footnote_extra("1234567")

    def test_decimal_no_cero_no_serial(self):
        """43131.5 no es serial date — un serial date siempre es .0 (Excel
        guarda fechas como float entero)."""
        assert not _is_annotation_or_footnote_extra("43131.5")

    # --- ISO dates ---
    def test_iso_date_con_hora(self):
        """'2018-01-31 00:00:00' = fecha del periodo publicada como header."""
        assert _is_annotation_or_footnote_extra("2018-01-31 00:00:00")

    def test_iso_date_sin_hora(self):
        assert _is_annotation_or_footnote_extra("2020-12-31")

    def test_iso_date_con_segundos(self):
        assert _is_annotation_or_footnote_extra("2019-06-15 23:59:59")

    # --- Tipo de Cambio Contable ---
    def test_tipo_de_cambio_variantes(self):
        assert _is_annotation_or_footnote_extra("Tipo de Cambio Contable: S/. 2,772")
        assert _is_annotation_or_footnote_extra("Tipo de Cambio Contable: S/ 3,491")
        assert _is_annotation_or_footnote_extra("Tipo de Cambio Contable:  S/. 3,216")

    # --- Sheet title bleed ---
    def test_balance_general_por_es_anotacion(self):
        """El title de la hoja a veces aparece en la primera fila de data."""
        assert _is_annotation_or_footnote_extra("Balance General por Empresa Bancaria")
        assert _is_annotation_or_footnote_extra("Balance General por Caja Municipal*")
        assert _is_annotation_or_footnote_extra("Balance General por Empresa de Créditos (**)")

    def test_estado_de_ganancias_y_perdidas(self):
        assert _is_annotation_or_footnote_extra(
            "Estado de Ganancias y Pérdidas por Empresa Financiera"
        )
        assert _is_annotation_or_footnote_extra(
            "Estado de Ganancias y Perdidas por Entidad de Desarrollo de la Pequeña y Micro Empresa"
        )

    # --- Unit notes ---
    def test_unit_note_miles_de_soles(self):
        assert _is_annotation_or_footnote_extra("(En miles de soles)")
        assert _is_annotation_or_footnote_extra("(En miles de nuevos soles)")

    # --- Publication date ---
    def test_actualizado_al(self):
        assert _is_annotation_or_footnote_extra("Actualizado al 28-03-2012")
        assert _is_annotation_or_footnote_extra("Actualizado el 26-02-2019")

    # --- Parenthesized footnotes (caso CMAC Arequipa / CRAC Luren) ---
    def test_footnote_parentizado_un_asterisco(self):
        nota = (
            '(*) Con relación a la CMAC Arequipa, en el rubro 19 "Otros Activos" '
            "se registra la cartera crediticia bruta adquirida de la CRAC Luren..."
        )
        assert _is_annotation_or_footnote_extra(nota)

    def test_footnote_parentizado_doble_asterisco(self):
        assert _is_annotation_or_footnote_extra("(**) Texto explicativo de SBS")

    # --- Negativos: cuentas reales con nombres parecidos NO deben matchear ---
    def test_cuenta_con_paren_no_matchea(self):
        """Cuentas con parentesis al medio o al final, pero que no empiezan con
        '(*)' son cuentas reales."""
        assert not _is_annotation_or_footnote_extra("Resultado Neto del Ejercicio")
        assert not _is_annotation_or_footnote_extra(
            "Inversiones en Subsidiarias, Asociadas y Negocios Conjuntos"
        )

    def test_cuenta_que_empieza_con_actualizar_no_matchea(self):
        """'Actualizado' es estricto: debe ir seguido de 'al ' o 'el '."""
        assert not _is_annotation_or_footnote_extra("Actualizaciones de Inversiones")
