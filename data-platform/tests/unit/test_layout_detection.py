"""Tests de los detectores de layout en monthly_*_importer.

NO tocan la base de datos — solo prueban la logica pura de deteccion
de fechas, headers, productos sobre `XlsSheet` sinteticos.

Cubre los layouts agregados en el fix de hoy:
- clientes_credito: empresa col 0 o col 1, productos en row previa al header
- depositos: 'Empresas' opcional (inferencia por productos Vista/Ahorro/...)
- colocaciones: 'Entidad' / 'Entidades' como header, productos legacy
- castigos: deteccion de fecha en castellano + filename fallback
"""

from __future__ import annotations

from pathlib import Path

from aibenchef_data.domains.loading.services.monthly_castigos_importer import (
    _extract_fecha_from_filename as castigos_fecha_filename,
)
from aibenchef_data.domains.loading.services.monthly_clientes_importer import (
    _detect_layout as clientes_detect_layout,
)
from aibenchef_data.domains.loading.services.monthly_colocaciones_importer import (
    _detect_layout as colocaciones_detect_layout,
)
from aibenchef_data.domains.loading.services.monthly_colocaciones_importer import (
    _producto_canonico as colocaciones_producto_canonico,
)
from aibenchef_data.domains.loading.services.monthly_depositos_importer import (
    _extract_fecha_from_filename as depositos_fecha_filename,
)
from aibenchef_data.domains.loading.services.monthly_depositos_importer import (
    _find_header_row as depositos_find_header,
)
from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
    _detect_layout as eeff_detect_layout,
)
from aibenchef_data.domains.parsing.services.xls_reader import XlsSheet


def _sheet(rows: list[list]) -> XlsSheet:
    """Construye un XlsSheet a partir de filas heterogeneas."""
    if not rows:
        return XlsSheet(name="t", n_rows=0, n_cols=0, rows=[])
    n_cols = max(len(r) for r in rows)
    padded = [r + [None] * (n_cols - len(r)) for r in rows]
    return XlsSheet(name="t", n_rows=len(rows), n_cols=n_cols, rows=padded)


# ===========================================================================
# clientes_credito — _detect_layout
# ===========================================================================


class TestClientesDetectLayout:
    def test_layout_moderno_empresa_col_0(self):
        """Layout 2015+: 'Empresas' en col 0, productos en la misma fila."""
        sheet = _sheet(
            [
                [None, "Numero de Deudores"],
                [None, 42_000],
                [None, None],
                ["Empresas", "Corporativo", "Grandes Empresas", "Total de deudores"],
                ["BCP", 100, 200, 300],
            ]
        )
        layout = clientes_detect_layout(sheet)
        assert layout is not None
        assert layout["empresa"] == 0
        assert layout["total"] == 3
        assert ("Corporativo", 1) in layout["productos"]
        assert ("Grandes Empresas", 2) in layout["productos"]

    def test_layout_banca_pre_2015_empresa_col_1(self):
        """Pre-2015 BANCOS: codigo en col 0, 'Empresas' en col 1.

        Reproduce el archivo B-230803-jn2012.xls real: tiene productos
        completos en row previa (R4) y headers abreviados ('Deudores Corp...')
        en el header row (R6). El detector debe encontrar empresa en col 1
        y al menos 4 productos canonicos.
        """
        sheet = _sheet(
            [
                [None, "Numero de Deudores"],
                [None, 41_090],
                [None, None],
                [None, None, 3, 4, 6, 8, 7, 2, 5],
                [
                    None,
                    None,
                    "Corporativo",
                    "Grandes empresas",
                    "Medianas empresas",
                    "Pequenas empresas",
                    "Microempresas",
                    "Consumo",
                    "Hipotecario",
                ],
                [None, None, None, None, None, None, None, None, None],
                [
                    None,
                    "Empresas",
                    "Deudores Corporativos",
                    "Deudores Grandes",
                    "Deudores Medianas",
                    "Deudores Pequenas",
                    "Deudores Microempresas",
                    "Deudores Consumo",
                    "Deudores Hipotecarios",
                    "Total de deudores",
                ],
                [
                    "B B V A BANCO CON",
                    "B. Continental",
                    214,
                    1127,
                    10493,
                    16402,
                    3895,
                    314329,
                    43794,
                    375322,
                ],
            ]
        )
        layout = clientes_detect_layout(sheet)
        assert layout is not None
        assert layout["empresa"] == 1, "Empresa col debe ser 1 en layout pre-2015"
        # Con headers completos esperamos detectar los 7 productos canonicos
        assert len(layout["productos"]) >= 6, (
            f"Esperaba >=6 productos, obtuve {layout['productos']}"
        )

    def test_layout_sin_empresas_devuelve_none(self):
        sheet = _sheet([["foo", "bar"], ["a", 1]])
        assert clientes_detect_layout(sheet) is None

    def test_layout_sin_total_devuelve_none(self):
        sheet = _sheet(
            [
                ["Empresas", "Corporativo", "Microempresa"],
                ["BCP", 1, 2],
            ]
        )
        # No tiene columna Total -> debe devolver None
        layout = clientes_detect_layout(sheet)
        assert layout is None


# ===========================================================================
# depositos — _find_header_row
# ===========================================================================


class TestDepositosFindHeader:
    def test_header_moderno_empresas_col_0(self):
        sheet = _sheet(
            [
                [None, "Depositos por Tipo"],
                [None, "Saldos al 31/12/2024"],
                ["Empresas", "Vista PN", "Vista PJ", "Ahorro PN"],
                [None, None, None, None],
                ["BCP", 100, 200, 300],
            ]
        )
        result = depositos_find_header(sheet)
        assert result is not None
        header_row, empresa_col = result
        assert header_row == 2
        assert empresa_col == 0

    def test_header_2009_sin_empresas_inferido_por_productos(self):
        """2009-2010 BANCOS no tiene texto 'Empresas'; inferimos por presencia
        de tipos de deposito en una fila."""
        sheet = _sheet(
            [
                [None, "Depositos por Tipo"],
                [None, "Saldos al 30/09/2010"],
                [None, None],
                [None, None],
                [None, None],
                [None, None, "Vista", "Vista", "Ahorro", "Ahorro", "Plazo", "Plazo", "CTS"],
                [None, "Personas Nat", "PJ no lucro", "Otras PJ", "PN", "PJ", "Otras", "PN", "PJ"],
                [None, None, None, None, None, None, None, None, None],
                [None, "B. Continental", 100, 200, 300, 400, 500, 600, 700],
            ]
        )
        result = depositos_find_header(sheet)
        assert result is not None
        header_row, empresa_col = result
        # En este layout la fila con tipos es 5; empresa col es 1 (B. Continental)
        assert header_row == 5
        assert empresa_col == 1


class TestDepositosFechaFilename:
    def test_extrae_fecha_de_filename_estandar(self):
        p = Path("/tmp/B-2372-fe2015.xls")
        result = depositos_fecha_filename(p)
        assert result is not None
        periodo, fecha_iso = result
        assert periodo == 201502
        assert fecha_iso == "2015-02-28"

    def test_extrae_fecha_diciembre(self):
        p = Path("/tmp/C-1245-di2023.xls")
        result = depositos_fecha_filename(p)
        assert result == (202312, "2023-12-31")

    def test_setiembre_es_septiembre(self):
        p = Path("/tmp/B-2372-se2020.xls")
        result = depositos_fecha_filename(p)
        assert result == (202009, "2020-09-30")

    def test_filename_invalido_retorna_none(self):
        p = Path("/tmp/no_es_sbs.xls")
        assert depositos_fecha_filename(p) is None


# ===========================================================================
# colocaciones — _detect_layout + _producto_canonico
# ===========================================================================


class TestColocacionesDetectLayout:
    def test_layout_horizontal_moderno(self):
        sheet = _sheet(
            [
                [None, "Cuadro N 51"],
                [None, "Creditos Directos"],
                [None, "2024-12-31"],
                [None, None],
                [None, None],
                ["Empresas", "Corporativo", None, None, "Grandes Empresas"],
            ]
        )
        assert colocaciones_detect_layout(sheet) == "horizontal"

    def test_layout_horizontal_empresa_col_1_legacy_comercial(self):
        """Pre-2015 banca: 'Empresas' en col 1, primer producto = 'Comerciales'."""
        sheet = _sheet(
            [
                [None, "Cuadro N 18"],
                [None, "Creditos Directos"],
                [None, 39_844],
                [None, None],
                [None, None],
                [None, "Empresas", "Comerciales", None, None, None, "A Microempresas"],
            ]
        )
        assert colocaciones_detect_layout(sheet) == "horizontal"

    def test_layout_horizontal_cmac_2010_entidad(self):
        """CMAC 2010: header 'Entidad' (no 'Empresas') + 'Actividades empresariales'."""
        sheet = _sheet(
            [
                ["Creditos Directos"],
                [None],
                [None],
                [None],
                ["Entidad", "Actividades empresariales", None, None, None, "Consumo"],
            ]
        )
        assert colocaciones_detect_layout(sheet) == "horizontal"

    def test_layout_transpuesto_cmac_moderno(self):
        sheet = _sheet(
            [
                [None],
                [None],
                ["Tipo de credito", "Situacion", "CMAC Arequipa", "CMAC Cusco"],
            ]
        )
        assert colocaciones_detect_layout(sheet) == "transpuesto"

    def test_layout_no_detectable(self):
        sheet = _sheet([["foo", "bar"], ["baz", "qux"]])
        assert colocaciones_detect_layout(sheet) is None


class TestColocacionesProductoCanonico:
    def test_corporativo(self):
        assert colocaciones_producto_canonico("Corporativo") == "Corporativo"
        assert colocaciones_producto_canonico("Corporativos") == "Corporativo"

    def test_pequenas_acentos(self):
        assert colocaciones_producto_canonico("Pequenas Empresas") == "Pequeña Empresa"
        assert colocaciones_producto_canonico("Pequeñas empresas") == "Pequeña Empresa"

    def test_actividades_empresariales_legacy(self):
        """REGRESION: 'Actividades empresariales' debe mapear a 'Comerciales'."""
        assert colocaciones_producto_canonico("Actividades empresariales") == "Comerciales"
        assert colocaciones_producto_canonico("Comerciales") == "Comerciales"

    def test_microempresa(self):
        assert colocaciones_producto_canonico("Microempresa") == "Microempresa"
        assert colocaciones_producto_canonico("Micro empresas") == "Microempresa"

    def test_no_match(self):
        assert colocaciones_producto_canonico("Foo bar") is None
        assert colocaciones_producto_canonico("") is None
        assert colocaciones_producto_canonico(None) is None  # type: ignore[arg-type]


# ===========================================================================
# castigos — _extract_fecha_from_filename
# ===========================================================================


class TestCastigosFechaFilename:
    def test_extrae_fecha_banca(self):
        p = Path("/tmp/B-2369-ma2010.xls")
        result = castigos_fecha_filename(p)
        assert result == (201003, "2010-03-31")

    def test_extrae_fecha_cmac(self):
        p = Path("/tmp/C-1253-di2014.xls")
        result = castigos_fecha_filename(p)
        assert result == (201412, "2014-12-31")

    def test_filename_sin_fecha_devuelve_none(self):
        assert castigos_fecha_filename(Path("/tmp/random.xls")) is None

    def test_filename_mes_invalido(self):
        # 'xx' no es un mes valido
        assert castigos_fecha_filename(Path("/tmp/B-2369-xx2020.xls")) is None

    def test_filename_anio_fuera_rango(self):
        # 1990 esta fuera del rango 2000-2050
        assert castigos_fecha_filename(Path("/tmp/B-2369-en1990.xls")) is None


# ===========================================================================
# _detect_layout (monthly_eeff_importer) — entidades adyacentes sin separador
# ===========================================================================


class TestEeffDetectLayoutEntidadesAdyacentes:
    """Regresion: cuando dos entidades son adyacentes sin columna separadora
    en la fila de monedas (caso Norandino→Kori en COOPAC N2B desde SEP-2025),
    el scanner sobre-escaneaba sobreescribiendo las columnas de la primera
    entidad con las de la segunda, y dejando a la segunda sin procesar.
    """

    def _make_coopac_sheet(self) -> XlsSheet:
        """Hoja BG con 3 entidades:
          - Alfa  (cols 1-3, con separador None en col 4)
          - Beta  (cols 5-7, con separador None en col 4)
          - Gamma (cols 8-10, ADYACENTE a Beta — sin separador entre TOTAL(7) y MN(8))

        En el layout real COOPAC N2B el nombre de entidad aparece en la misma
        columna que su MN currency. Esta es la condicion que dispara el bug:
        el scanner de monedas para Beta (col 5) continua a col 8 (MN de Gamma)
        sobreescribiendo el dict y dejando a Gamma sin procesar.

        Layout COOPAC:
          row 0-4: titulos y fecha
          row 5:   nombres de entidades
          row 6:   MN/ME/TOTAL por entidad
          row 7:   vacio
          row 8+:  datos
        """
        return _sheet([
            ["Esta publicacion..."],                            # row 0
            ["Balance General por Cooperativas N2B"],          # row 1
            ["2026-08-31", None, None],                        # row 2 — fecha
            ["(En Miles de Soles)"],                           # row 3
            [None],                                            # row 4
            # row 5: nombre de entidad en la MISMA col que su MN (layout real)
            [None, "Alfa", None, None, None, "Beta", None, None, "Gamma", None, None],
            # row 6: Alfa(1-3) | sep None(4) | Beta(5-7) | Gamma(8-10) sin sep
            [None, "MN", "ME", "TOTAL", None, "MN", "ME", "TOTAL", "MN", "ME", "TOTAL"],
            [None],                                            # row 7 — vacio
            # row 8: datos
            [None, 100, 10, 110, None, 200, 20, 220, 300, 30, 330],
        ])

    def test_detecta_tres_entidades(self):
        layout = eeff_detect_layout(self._make_coopac_sheet())
        nombres = [e.nombre for e in layout.entidades]
        assert "Alfa" in nombres
        assert "Beta" in nombres
        assert "Gamma" in nombres
        assert len(nombres) == 3

    def test_alfa_columnas_correctas(self):
        layout = eeff_detect_layout(self._make_coopac_sheet())
        alfa = next(e for e in layout.entidades if e.nombre == "Alfa")
        assert alfa.monedas["MN"] == 1
        assert alfa.monedas["ME"] == 2
        assert alfa.monedas["TOTAL"] == 3

    def test_beta_columnas_correctas(self):
        """Beta tiene separador None antes (col 4) y Gamma adyacente despues."""
        layout = eeff_detect_layout(self._make_coopac_sheet())
        beta = next(e for e in layout.entidades if e.nombre == "Beta")
        assert beta.monedas["MN"] == 5
        assert beta.monedas["ME"] == 6
        assert beta.monedas["TOTAL"] == 7

    def test_gamma_columnas_correctas(self):
        """Gamma esta adyacente a Beta (cols 8-10) sin separador entre ellas.
        El bug causaba que Beta sobreescribiera sus monedas con las de Gamma
        y dejara a Gamma sin procesar (nunca aparecia en layout.entidades)."""
        layout = eeff_detect_layout(self._make_coopac_sheet())
        gamma = next(e for e in layout.entidades if e.nombre == "Gamma")
        assert gamma.monedas["MN"] == 8
        assert gamma.monedas["ME"] == 9
        assert gamma.monedas["TOTAL"] == 10

    def test_beta_no_apunta_a_columnas_de_gamma(self):
        layout = eeff_detect_layout(self._make_coopac_sheet())
        beta = next(e for e in layout.entidades if e.nombre == "Beta")
        assert beta.monedas["MN"] == 5, "Beta debe apuntar a su propia col MN(5), no a Gamma(8)"

    def test_periodo_detectado(self):
        layout = eeff_detect_layout(self._make_coopac_sheet())
        assert layout.periodo_yyyymm == 202608
