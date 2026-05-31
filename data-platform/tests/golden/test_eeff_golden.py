"""Tests sobre el golden dataset EEFF.

V1 (este archivo): valida que el gold mismo sea coherente.
    Si el gold esta corrupto, los tests futuros que dependan no valen.

V2 (pendiente): para cada (entidad, periodo, moneda) en el gold, correr el
    parser EEFF real y comparar. Requiere integration con Postgres
    (testcontainers) porque el parser inserta a raw.eeff_observacion.

Filosofia: `.claude/rules/testing-philosophy.md`
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

GOLDEN_PATH = Path(__file__).parent / "eeff_golden.parquet"


@pytest.fixture(scope="module")
def golden() -> pd.DataFrame:
    """Carga el golden parquet una sola vez por modulo."""
    if not GOLDEN_PATH.exists():
        pytest.skip(
            f"Golden no existe en {GOLDEN_PATH}. "
            f"Generalo con: uv run python scripts/build_golden_eeff.py"
        )
    return pd.read_parquet(GOLDEN_PATH)


# =============================================================================
# Tests de coherencia del gold mismo
# =============================================================================


@pytest.mark.golden
def test_gold_no_esta_vacio(golden: pd.DataFrame) -> None:
    """Golden dataset debe tener al menos 100 filas para ser util."""
    assert len(golden) >= 100, (
        f"Golden tiene solo {len(golden)} filas — demasiado chico para validar"
    )


@pytest.mark.golden
def test_gold_cubre_multiples_tipos_entidad(golden: pd.DataFrame) -> None:
    """Golden debe cubrir al menos 3 grupos SBS distintos.

    Si el muestreo dejo solo 1-2 grupos, los tests basados en el gold no
    cubririan la diversidad de planes contables SBS.
    """
    tipos = golden["tipo_entidad"].dropna().unique()
    assert len(tipos) >= 3, f"Golden cubre solo {len(tipos)} tipos: {tipos}"


@pytest.mark.golden
def test_gold_cubre_balance_y_resultados(golden: pd.DataFrame) -> None:
    """Golden debe tener filas de ambos estados, balance y resultados."""
    estados = set(golden["tipo_estado"].unique())
    assert estados == {"balance", "resultados"}, f"tipo_estado inesperado: {estados}"


@pytest.mark.golden
def test_periodos_son_yyyymm_validos(golden: pd.DataFrame) -> None:
    """Cada periodo debe ser un YYYYMM valido.

    Invariante: mes BETWEEN 1 AND 12, anio plausible para SBS (2000-2030).
    """
    periodos = golden["periodo"].unique()
    for p in periodos:
        anio = p // 100
        mes = p % 100
        assert 2000 <= anio <= 2030, f"Anio fuera de rango: {p}"
        assert 1 <= mes <= 12, f"Mes invalido: {p}"


@pytest.mark.golden
def test_cuenta_codigo_no_es_nulo(golden: pd.DataFrame) -> None:
    """Toda fila en el gold debe tener cuenta_codigo extraido.

    Si esto falla, el regex de extract_codigo_y_nombre del script de
    generacion esta mal. El parser depende de tener codigos canonicos.
    """
    assert golden["cuenta_codigo"].notna().all(), "Hay cuenta_codigo NULL en el gold"


@pytest.mark.golden
def test_moneda_es_valor_permitido(golden: pd.DataFrame) -> None:
    """SBS solo publica monedas: MN, ME, TOTAL.

    Si aparece otra, el script de muestreo se rompio o el BASE EE.FF.
    cambio de convencion (caso que requiere updatear este test).
    """
    monedas = set(golden["moneda"].dropna().str.upper().unique())
    permitidas = {"MN", "ME", "TOTAL", "M.N.", "M.E."}
    assert monedas <= permitidas, f"Monedas inesperadas: {monedas - permitidas}"


@pytest.mark.golden
def test_valor_esperado_no_es_nulo(golden: pd.DataFrame) -> None:
    """Cualquier fila del gold debe tener valor — los NaN se filtran en el script."""
    assert golden["valor_esperado"].notna().all(), "Hay valores NaN en el gold"


@pytest.mark.golden
def test_nomb_correg_poblado_en_mayoria(golden: pd.DataFrame) -> None:
    """nomb_correg (nombre canonico) debe estar poblado para >90% de filas.

    Si menos del 90% tiene nomb_correg, el join con `dw.dim_empresa` y
    `dw.resolver_nomb_correg_canonico` va a perder mucho data en queries.
    """
    poblado = golden["nomb_correg"].notna().mean()
    assert poblado > 0.9, f"Solo {poblado:.1%} de filas tienen nomb_correg"


# =============================================================================
# Invariantes financieras del gold
# =============================================================================


@pytest.mark.golden
def test_cuentas_de_activo_brutas_son_no_negativas(golden: pd.DataFrame) -> None:
    """Cuentas de activo BRUTAS son siempre >= 0 en miles de soles.

    Excepciones legitimas (contracuentas del plan SBS, restan al bruto):
    - A3.8, A4.4: Provisiones
    - A4.5: Intereses y Comisiones no Devengados

    Si aparecen NUEVAS cuentas de activo con negativos, hay 2 posibilidades:
    1. SBS agrego una contracuenta nueva al plan → agregarla a CONTRACUENTAS
       y documentarlo aca.
    2. El extractor del gold tiene un bug → fixearlo.
    """
    CONTRACUENTAS = {"A3.8", "A4.4", "A4.5"}

    balance = golden[golden["tipo_estado"] == "balance"].copy()
    activos = balance[balance["cuenta_codigo"].str.startswith("A", na=False)]
    activos_brutos = activos[~activos["cuenta_codigo"].isin(CONTRACUENTAS)]

    negativos = activos_brutos[activos_brutos["valor_esperado"] < 0]
    tasa = len(negativos) / max(1, len(activos_brutos))

    # Permitir <0.5% por ajustes contables aislados (canje en transito, etc.).
    # Si crece, probablemente apareció contracuenta nueva no listada.
    assert tasa < 0.005, (
        f"{tasa:.2%} de activos BRUTOS son negativos "
        f"({len(negativos)}/{len(activos_brutos)}). "
        f"Top cuentas anomalas: "
        f"{negativos.groupby('cuenta_codigo').size().sort_values(ascending=False).head(5).to_dict()}"
    )


@pytest.mark.golden
def test_cuenta_codigo_matchea_patron_canonico(golden: pd.DataFrame) -> None:
    """Todos los codigos deben matchear el patron SBS:
    - Balance: A1, A1.1, B1, B1.2, C1, C1.3
    - Resultados: 1, 1.1, 2, 2.3
    """
    import re

    pat = re.compile(r"^[A-Z]?\d+(\.\d+)*$")
    invalidos = golden[~golden["cuenta_codigo"].str.match(pat, na=False)]
    assert invalidos.empty, (
        f"Codigos invalidos detectados: {invalidos['cuenta_codigo'].unique()[:10]}"
    )
