"""Tests unitarios para MonthlyCoopacEeffImporter.

Verifican los mapas de cuentas y el helper de normalizacion sin necesidad
de conexion a DB ni archivos XLS reales.
"""

from __future__ import annotations

import pytest

from aibenchef_data.domains.loading.services.monthly_coopac_eeff_importer import (
    _PATH_COOPAC_TO_TIPO,
    MonthlyCoopacEeffImporter,
    _normalize,
)


class TestPathCoopacToTipo:
    """Verifica que el mapa de grupos COOPAC cubre los 4 niveles."""

    def test_n3_mapeado(self):
        assert _PATH_COOPAC_TO_TIPO["coopac_n3"] == "COOPAC_N3"

    def test_n2b_mapeado(self):
        assert _PATH_COOPAC_TO_TIPO["coopac_n2b"] == "COOPAC_N2B"

    def test_n2a_mapeado(self):
        assert _PATH_COOPAC_TO_TIPO["coopac_n2a"] == "COOPAC_N2A"

    def test_n1_mapeado(self):
        assert _PATH_COOPAC_TO_TIPO["coopac_n1"] == "COOPAC_N1"

    def test_cubre_exactamente_cuatro_grupos(self):
        assert len(_PATH_COOPAC_TO_TIPO) == 4


class TestGypCuentas:
    """Verifica que _GYP_CUENTAS tiene las cuentas PE clave para resultados."""

    def test_ingresos_financieros_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[(None, "ingresos financieros")] == "1"

    def test_gastos_financieros_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[(None, "gastos financieros")] == "2"

    def test_margen_financiero_bruto_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[(None, "margen financiero bruto")] == "3"

    def test_gastos_administrativos_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[(None, "gastos administrativos")] == "10"

    def test_personal_bajo_gastos_admin(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[("10", "personal")] == "10.1"

    def test_resultado_neto_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[(None, "resultado neto del ejercicio")] == "17"

    def test_provisiones_creditos_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[(None, "provisiones para creditos directos")] == "4"

    def test_creditos_directos_bajo_ingresos(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[("1", "creditos directos")] == "1.4"

    def test_obligaciones_socios_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[("2", "obligaciones con los socios")] == "2.1"

    def test_depreciacion_presente(self):
        assert MonthlyCoopacEeffImporter._GYP_CUENTAS[("12", "depreciacion")] == "12.7"


class TestBgCuentas:
    """Verifica que _BG_CUENTAS tiene las cuentas clave para el balance."""

    def test_creditos_directos_es_a4(self):
        # Cuenta critica para calculo de cartera en PE
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[("A", "creditos directos")] == "A4"

    def test_activo_nivel_cero(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[(None, "activo")] == "A"

    def test_pasivo_nivel_cero(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[(None, "pasivo")] == "B"

    def test_patrimonio_nivel_cero(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[(None, "patrimonio")] == "C"

    def test_disponible_bajo_activo(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[("A", "disponible")] == "A1"

    def test_obligaciones_socios_presente(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[("B", "obligaciones con los socios")] == "B1"

    def test_capital_social_presente(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[("C", "capital social")] == "C1"

    def test_creditos_vigentes_bajo_a4(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[("A4", "creditos vigentes")] == "A4.1"

    def test_provisiones_bajo_a4(self):
        assert MonthlyCoopacEeffImporter._BG_CUENTAS[("A4", "provisiones")] == "A4.6"


class TestNormalize:
    """Verifica que _normalize funciona correctamente para los nombres COOPAC."""

    def test_mayusculas_a_minusculas(self):
        assert _normalize("GASTOS ADMINISTRATIVOS") == "gastos administrativos"

    def test_quita_acentos(self):
        assert _normalize("CRÉDITOS DIRECTOS") == "creditos directos"

    def test_strip_espacios(self):
        assert _normalize("  Disponible  ") == "disponible"

    def test_quita_asterisco_final(self):
        assert _normalize("Vigentes*") == "vigentes"

    def test_colapsa_espacios_multiples(self):
        assert _normalize("gastos   por   servicios") == "gastos por servicios"

    def test_reemplaza_puntuacion_por_espacio(self):
        # Parentesis y puntos se reemplazan por espacio, luego se colapsan
        assert _normalize("C.T.S.") == "c t s"
