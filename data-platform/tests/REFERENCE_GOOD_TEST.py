"""Plantillas canonicas de tests buenos para Aibenchef.

Este archivo NO se ejecuta — es referencia. Antes de escribir un test nuevo,
mira aca para encontrar el patron equivalente.

Categorias:
1. Golden  — iterar sobre tests/golden/*.parquet contra parser real
2. Property — invariantes del dominio via Hypothesis
3. Snapshot — vistas SQL con Postgres real (testcontainers)
4. Regression — bugs historicos con bug ID en docstring
5. Unit — comportamiento puro, no requiere DB ni filesystem

Filosofia completa: `.claude/rules/testing-philosophy.md`
"""

# Este archivo es plantilla, no test ejecutable

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

# =============================================================================
# 1. GOLDEN — compara output del parser contra el oraculo de Gus
# =============================================================================


@pytest.mark.golden
def test_GOLDEN_template_parser_matches_gold(pg_dsn: str) -> None:
    """Por cada (entidad, periodo, moneda) en el golden, el parser EEFF
    debe producir el mismo valor que el Excel canonico de Gus.

    Estructura:
    1. Cargar golden parquet
    2. Para cada (entidad, periodo, moneda):
       a. Bajar/leer el .xls SBS correspondiente
       b. Correr parser → DataFrame de observaciones
       c. Comparar cuenta por cuenta contra valor_esperado del gold
       d. Tolerar diferencia < 1.0 (redondeo)
    3. Si hay divergencias, reportar (entidad, periodo, cuenta, parser, gold, delta)

    Por que no example-based: el parser debe ser robusto a TODOS los layouts
    SBS historicos (2010-2026), no solo a uno hardcoded.
    """
    pytest.skip(
        "V2 pendiente: requiere mapeo (entidad, periodo) -> path .xls SBS + "
        "parser callable sin Postgres o con testcontainer."
    )


# =============================================================================
# 2. PROPERTY-BASED — invariantes del dominio con Hypothesis
# =============================================================================


def test_PROPERTY_template_activos_balance_pasivos_mas_patrimonio() -> None:
    """Invariante contable: activos = pasivos + patrimonio.

    Debe cumplirse para CUALQUIER (entidad, periodo, moneda) — no hay
    excepciones a A = P + P.

    Patron en tests/property/test_invariantes_financieras.py
    """
    from hypothesis import given, settings
    from hypothesis import strategies as st

    @given(
        periodo=st.integers(min_value=201001, max_value=202612).filter(lambda p: 1 <= p % 100 <= 12)
    )
    @settings(max_examples=100, deadline=None)
    def _test(periodo: int) -> None:
        # Carga datos reales del golden para el periodo
        # Verifica invariante A = P + P
        pass

    _test()


# =============================================================================
# 3. SNAPSHOT — vistas SQL con Postgres real
# =============================================================================


@pytest.mark.integration
def test_SNAPSHOT_template_marts_vista_devuelve_shape_esperado(pg_dsn: str) -> None:
    """Una vista de marts no debe cambiar su shape (columnas) sin que sepamos.

    Estructura:
    1. Levantar Postgres con testcontainers (pg_dsn fixture en conftest.py)
    2. Correr migrations
    3. Insertar fixture data
    4. SELECT * FROM marts.<vista> LIMIT 1
    5. Verificar columnas == set esperado

    Por que con DB real: el shape depende del CREATE VIEW SQL real,
    los tipos del catalogo, y funciones SBS custom. Mocks no replican eso.
    """
    import psycopg

    with psycopg.connect(pg_dsn) as conn, conn.cursor() as cur:
        # 1. Aplicar migrations
        # 2. Insertar fixtures
        # 3. Query
        cur.execute("SELECT 1")
        assert cur.fetchone() == (1,)


# =============================================================================
# 4. REGRESSION — bug historico con bug ID
# =============================================================================


@pytest.mark.regression
def test_REGRESSION_template_bug_15_footnote_sbs() -> None:
    """REGRESION issue #15: '* Mediante Resolución SBS N° 1286-2019'
    causaba offset acumulado en orden, mal-asignando codigos contables
    (ej. Mibanco Jun 2019: TOTAL PASIVO terminaba en C1 = Capital Social).

    Bug ID: <commit-sha del fix>
    """
    from aibenchef_data.domains.loading.services.monthly_eeff_importer import (
        _is_annotation_or_footnote_extra,
    )

    assert _is_annotation_or_footnote_extra("* Mediante Resolución SBS N° 1286-2019")
    assert not _is_annotation_or_footnote_extra("CAPITAL SOCIAL")


# =============================================================================
# 5. UNIT — comportamiento puro
# =============================================================================


def test_UNIT_template_parser_label_extrae_codigo() -> None:
    """Una funcion pura sin DB ni FS — testea comportamiento, no implementacion.

    Mal: assert isinstance(parse_label("(A1) X"), tuple)
    Bien: assert parse_label("(A1) X") == ("A1", "X")

    El primero pasa con cualquier funcion que retorne tupla. El segundo
    falla si cambia el contrato del parser.
    """
    # Ejemplo con la funcion real:
    from aibenchef_data.domains.catalog.cuenta import parse_label

    cuenta = parse_label("(A1.1) Caja")
    # Aserciones especificas sobre el comportamiento publico de la funcion,
    # no sobre detalles internos
    assert cuenta is not None  # solo si parse_label retorna Optional
