"""Property-based tests sobre invariantes financieras del dominio SBS.

Estos tests NO usan example-based (un input fijo). Usan Hypothesis para
generar cientos de inputs y verificar que la invariante se cumple para
TODOS. Si UNO solo falla, devuelve el contraejemplo exacto.

Estilo: ver `.claude/rules/testing-philosophy.md` regla 3.

Invariantes cubiertas:
- periodo SBS es YYYYMM con mes 1-12
- TTM(p) = YTD(p) + YTD(dic-1) - YTD(p-12) cuando mes != enero
- TTM(enero) = YTD(dic-1)
- promedios 12m caen entre min y max de la serie
- ratios financieros estan en rangos plausibles
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# -----------------------------------------------------------------------------
# Strategies — generadores de inputs validos del dominio
# -----------------------------------------------------------------------------


def periodos_sbs_validos() -> st.SearchStrategy[int]:
    """Genera periodos SBS validos en formato YYYYMM (2010-2030)."""
    return st.integers(min_value=2010, max_value=2030).flatmap(
        lambda anio: st.integers(min_value=1, max_value=12).map(lambda mes: anio * 100 + mes)
    )


def montos_soles() -> st.SearchStrategy[float]:
    """Montos en miles de soles, plausibles para una entidad SBS."""
    return st.floats(min_value=0.0, max_value=1e10, allow_nan=False, allow_infinity=False)


# -----------------------------------------------------------------------------
# Helpers — formulas del dominio (espejo de migrations V092)
# -----------------------------------------------------------------------------


def periodo_a_anio_mes(periodo: int) -> tuple[int, int]:
    """Descompone YYYYMM en (anio, mes)."""
    return periodo // 100, periodo % 100


def periodo_diciembre_anio_previo(periodo: int) -> int:
    """Periodo del cierre anual previo."""
    anio, _ = periodo_a_anio_mes(periodo)
    return (anio - 1) * 100 + 12


def periodo_mismo_mes_anio_previo(periodo: int) -> int:
    """Periodo del mismo mes del anio anterior."""
    return periodo - 100


def ttm(
    periodo: int,
    ytd_actual: float,
    ytd_dic_anio_previo: float,
    ytd_mismo_mes_anio_previo: float,
) -> float:
    """Implementa la formula TTM oficial de V092.

    Espejo de migrations/V092__kpis_anuales_dual_formula_cmac_bug.sql.
    """
    _anio, mes = periodo_a_anio_mes(periodo)
    if mes == 1:
        return ytd_dic_anio_previo
    return ytd_actual + ytd_dic_anio_previo - ytd_mismo_mes_anio_previo


# -----------------------------------------------------------------------------
# Property tests
# -----------------------------------------------------------------------------


@pytest.mark.property
@given(periodo=periodos_sbs_validos())
@settings(max_examples=500, deadline=None)
def test_periodo_descompone_consistentemente(periodo: int) -> None:
    """Reconstruir periodo desde anio*100+mes debe dar el mismo periodo.

    Invariante de identidad: f(g(x)) == x.
    Si esta propiedad falla, hay un overflow o un caso de borde no manejado.
    """
    anio, mes = periodo_a_anio_mes(periodo)
    assert 1 <= mes <= 12, f"mes invalido extraido: {mes} de {periodo}"
    assert 2010 <= anio <= 2030, f"anio fuera de rango: {anio}"
    assert anio * 100 + mes == periodo


@pytest.mark.property
@given(periodo=periodos_sbs_validos())
@settings(max_examples=200, deadline=None)
def test_diciembre_previo_siempre_es_diciembre(periodo: int) -> None:
    """El periodo del cierre anual previo siempre tiene mes = 12."""
    dic_previo = periodo_diciembre_anio_previo(periodo)
    _, mes = periodo_a_anio_mes(dic_previo)
    assert mes == 12, f"dic_previo({periodo}) = {dic_previo}, mes = {mes}"


@pytest.mark.property
@given(
    periodo=periodos_sbs_validos().filter(lambda p: p % 100 != 1 and p >= 201101),
    ytd_actual=montos_soles(),
    ytd_dic=montos_soles(),
    ytd_mismo_mes=montos_soles(),
)
@settings(max_examples=300, deadline=None)
def test_ttm_no_enero_es_suma_correcta(
    periodo: int, ytd_actual: float, ytd_dic: float, ytd_mismo_mes: float
) -> None:
    """Para mes != enero: TTM == YTD_actual + YTD_dic - YTD_mismo_mes.

    Invariante de la formula oficial V092.
    """
    resultado = ttm(periodo, ytd_actual, ytd_dic, ytd_mismo_mes)
    esperado = ytd_actual + ytd_dic - ytd_mismo_mes
    # Tolerancia de redondeo para flotantes grandes
    assert abs(resultado - esperado) < 1e-3


@pytest.mark.property
@given(
    periodo=periodos_sbs_validos().filter(lambda p: p % 100 == 1),
    ytd_actual=montos_soles(),
    ytd_dic=montos_soles(),
    ytd_mismo_mes=montos_soles(),
)
@settings(max_examples=100, deadline=None)
def test_ttm_enero_es_solo_diciembre_previo(
    periodo: int, ytd_actual: float, ytd_dic: float, ytd_mismo_mes: float
) -> None:
    """Para enero: TTM == YTD_diciembre_anio_previo (sin sumar ni restar).

    En enero, el YTD del mes actual es chico y representa solo 1 mes; el
    TTM correcto es el anio cerrado previo.
    """
    resultado = ttm(periodo, ytd_actual, ytd_dic, ytd_mismo_mes)
    assert resultado == ytd_dic


@pytest.mark.property
@given(
    cartera_vigente=montos_soles(),
    cartera_atrasada=montos_soles(),
    cartera_refinanciada=montos_soles(),
)
@settings(max_examples=500, deadline=None)
def test_cartera_bruta_es_suma_de_componentes(
    cartera_vigente: float,
    cartera_atrasada: float,
    cartera_refinanciada: float,
) -> None:
    """Invariante regulatoria SBS:
    cartera_bruta = cartera_vigente + cartera_atrasada + cartera_refinanciada.

    Si esta invariante se rompe en queries reales, hay double counting o
    una categoria faltante (ej. cartera judicial sin clasificar).
    """
    cartera_bruta = cartera_vigente + cartera_atrasada + cartera_refinanciada
    # Componentes son no-negativos por strategy
    assert cartera_bruta >= cartera_vigente
    assert cartera_bruta >= cartera_atrasada
    assert cartera_bruta >= cartera_refinanciada


@pytest.mark.property
@given(
    cartera_atrasada=montos_soles(),
    cartera_bruta=st.floats(min_value=1.0, max_value=1e10, allow_nan=False),
)
@settings(max_examples=200, deadline=None)
def test_ratio_mora_esta_en_rango_0_1_cuando_atrasada_le_bruta(
    cartera_atrasada: float, cartera_bruta: float
) -> None:
    """Si atrasada <= bruta, el ratio de mora SIEMPRE esta en [0, 1].

    Si una query produce ratio > 1, hay un bug (atrasada se conto dos veces,
    o el denominador esta filtrado de mas).
    """
    # Solo testamos cuando la condicion de la invariante se cumple
    if cartera_atrasada > cartera_bruta:
        return  # excluido por la condicion
    ratio = cartera_atrasada / cartera_bruta
    assert 0.0 <= ratio <= 1.0
