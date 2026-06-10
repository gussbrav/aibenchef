"""Tests para _sliding_window_periodos en cli.py — fix de issue #126.

El bug original: queue-monthly solo encolaba el mes anterior. Si SBS publica
tarde (a veces hasta 45-90 dias despues), los archivos quedan en
no_publicado_sbs eterno. La ventana deslizante permite reintentar los ultimos
N meses cada vez que corre el cron.
"""

import pytest

from aibenchef_data.cli import _sliding_window_periodos


class TestSlidingWindow:
    def test_caso_normal_3_meses(self) -> None:
        """Junio 2026 con months_back=3 -> mayo, abril, marzo."""
        assert _sliding_window_periodos(2026, 6, 3) == [202605, 202604, 202603]

    def test_default_caso_real_bug_abril_2026(self) -> None:
        """Caso real del bug: el 2026-06-09 deberia haber incluido abril 2026."""
        result = _sliding_window_periodos(2026, 6, 3)
        assert 202604 in result, "abril 2026 (cuando se cayo el cron) debe estar"

    def test_solo_1_mes_compat_con_comportamiento_anterior(self) -> None:
        """months_back=1 = comportamiento original."""
        assert _sliding_window_periodos(2026, 6, 1) == [202605]

    def test_cruce_de_anio_enero(self) -> None:
        """Enero 2026 con months_back=3 -> dic, nov, oct del 2025."""
        assert _sliding_window_periodos(2026, 1, 3) == [202512, 202511, 202510]

    def test_cruce_de_anio_febrero(self) -> None:
        """Febrero 2026 con months_back=3 -> ene 2026, dic, nov 2025."""
        assert _sliding_window_periodos(2026, 2, 3) == [202601, 202512, 202511]

    def test_meses_back_largo(self) -> None:
        """months_back=12 cubre 1 anio atras."""
        result = _sliding_window_periodos(2026, 6, 12)
        assert len(result) == 12
        assert result[0] == 202605  # mas reciente
        assert result[-1] == 202506  # 1 anio atras
        # Strict decreasing
        assert all(result[i] > result[i + 1] for i in range(len(result) - 1))

    def test_diciembre_no_incluye_anio_siguiente(self) -> None:
        """Diciembre 2026 con months_back=3 -> nov, oct, sep 2026."""
        assert _sliding_window_periodos(2026, 12, 3) == [202611, 202610, 202609]

    @pytest.mark.parametrize(
        ("anio", "mes", "n", "esperado"),
        [
            (2026, 6, 1, [202605]),
            (2026, 6, 2, [202605, 202604]),
            (2026, 1, 1, [202512]),
            (2025, 3, 6, [202502, 202501, 202412, 202411, 202410, 202409]),
        ],
    )
    def test_parametrizado(self, anio: int, mes: int, n: int, esperado: list[int]) -> None:
        assert _sliding_window_periodos(anio, mes, n) == esperado
