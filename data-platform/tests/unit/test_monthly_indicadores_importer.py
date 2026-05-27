"""Tests para `MonthlyIndicadoresImporter` (parser SBS indicadores prudenciales).

Cubre detectores puros sin tocar DB:
- _seccion_canonica: normalizacion de secciones SBS
- _indicador_slug: slug estable de cada indicador
- _detect_entity_blocks: deteccion de bloques horizontales
- _extract_fecha / _extract_fecha_from_filename

Y un test de regresion sobre el archivo real B-2401-di2024.xls validando
el numero esperado de filas + algunos valores conocidos.
"""

from __future__ import annotations

from pathlib import Path

from aibenchef_data.domains.loading.services.monthly_indicadores_importer import (
    _detect_entity_blocks,
    _extract_fecha,
    _extract_fecha_from_filename,
    _find_entity_row,
    _indicador_slug,
    _seccion_canonica,
)
from aibenchef_data.domains.parsing import read_xls
from aibenchef_data.domains.parsing.services.xls_reader import XlsSheet


def _sheet(rows: list[list]) -> XlsSheet:
    if not rows:
        return XlsSheet(name="t", n_rows=0, n_cols=0, rows=[])
    n_cols = max(len(r) for r in rows)
    padded = [r + [None] * (n_cols - len(r)) for r in rows]
    return XlsSheet(name="t", n_rows=len(rows), n_cols=n_cols, rows=padded)


# ===========================================================================
# _seccion_canonica
# ===========================================================================


class TestSeccionCanonica:
    def test_solvencia(self):
        assert _seccion_canonica("SOLVENCIA") == "SOLVENCIA"

    def test_calidad_activos_con_asteriscos(self):
        assert _seccion_canonica("CALIDAD DE ACTIVOS**") == "CALIDAD_ACTIVOS"
        assert _seccion_canonica("CALIDAD DE ACTIVOS") == "CALIDAD_ACTIVOS"

    def test_eficiencia_con_tilde(self):
        assert _seccion_canonica("EFICIENCIA Y GESTIÓN") == "EFICIENCIA"

    def test_rentabilidad_lowercase(self):
        # debe normalizar mayusculas
        assert _seccion_canonica("rentabilidad") == "RENTABILIDAD"

    def test_liquidez(self):
        assert _seccion_canonica("LIQUIDEZ") == "LIQUIDEZ"

    def test_no_es_seccion(self):
        assert _seccion_canonica("Ratio de Capital Global") is None
        assert _seccion_canonica("") is None
        assert _seccion_canonica(None) is None  # type: ignore[arg-type]


# ===========================================================================
# _indicador_slug
# ===========================================================================


class TestIndicadorSlug:
    def test_slug_estable(self):
        assert _indicador_slug("Ratio de Capital Global") == "ratio_de_capital_global"

    def test_remueve_parentesis_con_fechas(self):
        """REGRESION: 'Ratio de Capital Global (al 30/11/2024)' y 'al 31/12/2024'
        deben generar el MISMO slug — sino tendriamos duplicados por mes."""
        a = _indicador_slug("Ratio de Capital Global (al 30/11/2024)")
        b = _indicador_slug("Ratio de Capital Global (al 31/12/2024)")
        assert a == b == "ratio_de_capital_global"

    def test_remueve_asteriscos(self):
        assert (
            _indicador_slug("Creditos Atrasados (criterio SBS)* / Creditos Directos")
            == "creditos_atrasados_creditos_directos"
        )

    def test_strip_accents(self):
        assert _indicador_slug("Eficiencia Y Gestión") == "eficiencia_y_gestion"

    def test_simbolos_a_underscore(self):
        # Espacios, slash, parentesis, etc -> underscore + colapso
        assert _indicador_slug("A / B / C") == "a_b_c"


# ===========================================================================
# _detect_entity_blocks
# ===========================================================================


class TestFindEntityRow:
    def test_layout_bancos_row_5(self):
        """BANCOS/FINANCIERAS: entidades en r5 (titulo en r1-3, spacer r4)."""
        rows = [[None] * 4 for _ in range(7)]
        rows[1][0] = "Indicadores Financieros"
        rows[2][0] = "2024-12-31"
        rows[5] = [None, "BCP", "BBVA", "Scotiabank"]
        sheet = _sheet(rows)
        assert _find_entity_row(sheet) == 5

    def test_layout_cmac_row_4(self):
        """CMAC/CRAC/EDPYMES: entidades en r4 (un header menos que BANCOS)."""
        rows = [[None] * 4 for _ in range(7)]
        rows[1][0] = "Indicadores Financieros"
        rows[2][0] = "45657"  # serial Excel
        rows[4] = [None, "CMAC Arequipa", "CMAC Cusco", "CMAC Piura"]
        sheet = _sheet(rows)
        assert _find_entity_row(sheet) == 4

    def test_no_entity_row_retorna_none(self):
        sheet = _sheet([[None] * 4 for _ in range(8)])
        assert _find_entity_row(sheet) is None

    def test_no_confunde_titulo_con_entidades(self):
        """REGRESION: si col 0 tiene texto, NO es la fila de entidades."""
        rows = [[None] * 4 for _ in range(7)]
        rows[3] = ["Algun titulo", "Texto", "Otro texto", None]
        rows[5] = [None, "BCP", "BBVA", "Scotia"]
        sheet = _sheet(rows)
        # Debe encontrar r5, NO r3 (porque r3 tiene texto en col 0)
        assert _find_entity_row(sheet) == 5


class TestDetectEntityBlocks:
    def test_un_solo_bloque(self):
        """Caso simple: 3 entidades contiguas, sin gap."""
        sheet = _sheet(
            [
                [None] * 4,
                [None] * 4,
                [None] * 4,
                [None] * 4,
                [None] * 4,
                [None, "BCP", "BBVA", "Scotiabank"],
            ]
        )
        bloques = _detect_entity_blocks(sheet)
        assert len(bloques) == 1
        icol, entities = bloques[0]
        assert icol == 0
        assert [e[0] for e in entities] == ["BCP", "BBVA", "Scotiabank"]
        assert [e[1] for e in entities] == [1, 2, 3]

    def test_dos_bloques_separados_por_gap(self):
        """SBS estandar: bloque1 | gap | bloque2."""
        sheet = _sheet(
            [
                [None] * 8,
                [None] * 8,
                [None] * 8,
                [None] * 8,
                [None] * 8,
                [None, "BCP", "BBVA", "Interbank", None, "Mibanco", "GNB", "Falabella"],
            ]
        )
        bloques = _detect_entity_blocks(sheet)
        assert len(bloques) == 2
        # Bloque 1: icol=0, entities at cols 1,2,3
        assert bloques[0][0] == 0
        assert [e[0] for e in bloques[0][1]] == ["BCP", "BBVA", "Interbank"]
        # Bloque 2: icol=4 (la columna del gap), entities at cols 5,6,7
        assert bloques[1][0] == 4
        assert [e[0] for e in bloques[1][1]] == ["Mibanco", "GNB", "Falabella"]

    def test_nombre_entidad_overflow_a_row_6(self):
        """SBS usa wrap visual: 'B. GNB' en r5, 'HSBC Bank Peru' en r6 misma col."""
        rows = [[None] * 3 for _ in range(7)]
        rows[5][1] = "B. GNB"
        rows[6][1] = "HSBC Bank Peru"
        rows[5][2] = "B. Falabella"
        sheet = _sheet(rows)
        bloques = _detect_entity_blocks(sheet)
        assert len(bloques) == 1
        # La entidad de col 1 combina los 2 textos
        entities = bloques[0][1]
        assert any("HSBC" in e[0] and "GNB" in e[0] for e in entities)

    def test_sin_entidades(self):
        sheet = _sheet([[None] * 3 for _ in range(8)])
        assert _detect_entity_blocks(sheet) == []


# ===========================================================================
# _extract_fecha / _extract_fecha_from_filename
# ===========================================================================


class TestExtractFecha:
    def test_iso_string_en_col_0(self):
        sheet = _sheet(
            [
                [None],
                ["Indicadores Financieros"],
                ["2024-12-31 00:00:00"],
                ["( En porcentaje )"],
            ]
        )
        result = _extract_fecha(sheet)
        assert result is not None
        periodo, fecha_iso = result
        assert periodo == 202412
        assert fecha_iso.startswith("2024-12")

    def test_serial_excel_en_col_0(self):
        # 45657 = 2024-12-31
        sheet = _sheet([[None], [None], [45657]])
        result = _extract_fecha(sheet)
        assert result is not None
        periodo, _ = result
        assert periodo == 202412

    def test_no_fecha_retorna_none(self):
        sheet = _sheet([[None] * 3 for _ in range(6)])
        assert _extract_fecha(sheet) is None


class TestExtractFechaFromFilename:
    def test_b_2401_banca(self):
        result = _extract_fecha_from_filename(Path("/tmp/B-2401-di2024.xls"))
        assert result == (202412, "2024-12-31")

    def test_c_1301_cmac(self):
        result = _extract_fecha_from_filename(Path("/tmp/C-1301-jn2020.xls"))
        assert result == (202006, "2020-06-30")

    def test_filename_invalido(self):
        assert _extract_fecha_from_filename(Path("/tmp/random.xls")) is None


# ===========================================================================
# Regresion con fixture real
# ===========================================================================


class TestIndicadoresFixtureReal:
    """REGRESION sobre B-2401-di2024.xls — el archivo SBS real de diciembre 2024.

    Si SBS cambia el layout o nosotros rompemos el parser, estos asserts fallan.
    """

    def test_lee_archivo_real(self, fixtures_dir: Path):
        sheets = read_xls(fixtures_dir / "indicadores_banca_2024.xls")
        assert len(sheets) == 1
        assert sheets[0].n_rows >= 30

    def test_detecta_2_bloques_de_entidades(self, fixtures_dir: Path):
        sheets = read_xls(fixtures_dir / "indicadores_banca_2024.xls")
        bloques = _detect_entity_blocks(sheets[0])
        # BANCOS dic-2024: 2 bloques (8 + 10 entidades) = 18 entidades reales
        assert len(bloques) == 2
        total_entities = sum(len(entities) for _, entities in bloques)
        assert total_entities >= 17  # 17 entidades + 1 TOTAL = 18

    def test_extrae_fecha_dic_2024(self, fixtures_dir: Path):
        sheets = read_xls(fixtures_dir / "indicadores_banca_2024.xls")
        fecha = _extract_fecha(sheets[0])
        assert fecha is not None
        assert fecha[0] == 202412

    def test_secciones_canonicas_en_archivo_real(self, fixtures_dir: Path):
        sheets = read_xls(fixtures_dir / "indicadores_banca_2024.xls")
        sheet = sheets[0]
        secciones_detectadas: set[str] = set()
        for r in range(sheet.n_rows):
            v = sheet.cell(r, 0)
            if v:
                canon = _seccion_canonica(str(v))
                if canon:
                    secciones_detectadas.add(canon)
        # Las 5 secciones esperadas
        assert secciones_detectadas == {
            "SOLVENCIA",
            "CALIDAD_ACTIVOS",
            "EFICIENCIA",
            "RENTABILIDAD",
            "LIQUIDEZ",
        }
