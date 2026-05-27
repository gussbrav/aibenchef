"""Tests para helpers de carga_log (issue #18, G2)."""

from __future__ import annotations

from pathlib import Path

import pytest

from aibenchef_data.domains.shared.carga_log import (
    VALID_STAGES,
    CargaLogState,
)


class TestValidStages:
    def test_stages_minimos(self):
        """Los 4 stages que se usan en V1 deben estar todos."""
        assert "scrape" in VALID_STAGES
        assert "import" in VALID_STAGES
        assert "refresh-mvs" in VALID_STAGES
        assert "detectar-cambios" in VALID_STAGES

    def test_backfill_disponible_para_recovery(self):
        """backfill se usa para fixes post-incidente (re-procesar archivos)."""
        assert "backfill" in VALID_STAGES


class TestCargaLogState:
    def test_defaults(self):
        state = CargaLogState(log_id=42)
        assert state.log_id == 42
        assert state.rows_inserted == 0
        assert state.rows_updated == 0
        assert state.rows_skipped == 0
        assert state.metadata == {}

    def test_metadata_es_mutable(self):
        state = CargaLogState(log_id=1)
        state.metadata["sheets"] = ["bg_cm", "gyp_cm"]
        state.rows_inserted = 1234
        assert state.metadata == {"sheets": ["bg_cm", "gyp_cm"]}
        assert state.rows_inserted == 1234


class TestExtractPeriodoFromPath:
    """Wrapper imports _extract_periodo_from_path desde cli.py.

    Es la funcion que infiere YYYYMM del nombre del archivo SBS (ej.
    B-2201-ma2026.xls → 202603). Cubre todos los meses abreviados que
    SBS usa.
    """

    def test_marzo_2026(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        assert _extract_periodo_from_path(Path("B-2201-ma2026.xls")) == 202603

    def test_abril_2026(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        assert _extract_periodo_from_path(Path("/x/y/B-3101-ab2026.xls")) == 202604

    def test_diciembre_2024(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        assert _extract_periodo_from_path(Path("C-1253-di2024.xls")) == 202412

    def test_enero_2020(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        assert _extract_periodo_from_path(Path("X-en2020.xls")) == 202001

    def test_path_sin_periodo_retorna_none(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        assert _extract_periodo_from_path(Path("base_eeff.xlsx")) is None

    def test_anio_fuera_de_rango_retorna_none(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        # Range valido es 2000-2050 (heurística defensiva contra noise).
        assert _extract_periodo_from_path(Path("B-ma1999.xls")) is None
        assert _extract_periodo_from_path(Path("B-ma2099.xls")) is None
        assert _extract_periodo_from_path(Path("B-ma2050.xls")) == 205003

    def test_mes_invalido_retorna_none(self):
        from aibenchef_data.cli import _extract_periodo_from_path

        # 'zz' no es un mes valido
        assert _extract_periodo_from_path(Path("B-zz2024.xls")) is None
