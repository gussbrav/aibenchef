"""Tests para EstructuraDiff (issue #18, G3)."""

from __future__ import annotations

from aibenchef_data.domains.catalog.services import EstructuraDiff


class TestSeverity:
    """Heurística de severidad para alertas del dashboard /admin/pipeline."""

    def test_sin_diffs_es_info(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="BANCOS",
            tipo_estado="balance",
            archivo="B.xls",
            n_filas_archivo=85,
            n_filas_maestra=85,
        )
        assert d.severity == "info"
        assert d.total_diffs == 0

    def test_un_extra_es_warning(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="BANCOS",
            tipo_estado="balance",
            archivo="B.xls",
            extras=[{"orden": 62, "archivo": "* Mediante Resolucion..."}],
        )
        assert d.severity == "warning"
        assert d.n_extras == 1

    def test_un_rename_es_warning(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="BANCOS",
            tipo_estado="balance",
            archivo="B.xls",
            renames=[{"orden": 10, "archivo": "Caja", "cabecera": "Disponible", "codigo": "A1"}],
        )
        assert d.severity == "warning"

    def test_muchos_missing_es_critical(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="BANCOS",
            tipo_estado="balance",
            archivo="B.xls",
            missing=[{"orden": i, "cabecera": f"Cuenta {i}", "codigo": f"X{i}"} for i in range(6)],
        )
        assert d.severity == "critical"
        assert d.n_missing == 6

    def test_cinco_missing_es_warning(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="BANCOS",
            tipo_estado="balance",
            archivo="B.xls",
            missing=[{"orden": i, "cabecera": f"Cuenta {i}", "codigo": f"X{i}"} for i in range(5)],
        )
        assert d.severity == "warning"

    def test_mix_es_warning_no_critical_si_missing_pocos(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="BANCOS",
            tipo_estado="balance",
            archivo="B.xls",
            renames=[{"orden": 1, "archivo": "X", "cabecera": "Y", "codigo": "A1"}],
            extras=[{"orden": 99, "archivo": "footnote"}],
            missing=[{"orden": 100, "cabecera": "Z", "codigo": "B1"}],
        )
        assert d.severity == "warning"
        assert d.total_diffs == 3


class TestPayload:
    """Serialización a admin.estructura_diffs.payload (jsonb)."""

    def test_payload_structure(self):
        d = EstructuraDiff(
            periodo=202604,
            grupo="CMAC",
            tipo_estado="resultados",
            archivo="C-1101.xls",
            n_filas_archivo=42,
            n_filas_maestra=40,
            renames=[{"orden": 5, "archivo": "X", "cabecera": "Y", "codigo": "I1"}],
            extras=[{"orden": 41, "archivo": "Note 1"}, {"orden": 42, "archivo": "Note 2"}],
            missing=[],
        )
        payload = d.to_payload()
        assert "renames" in payload
        assert "extras" in payload
        assert "missing" in payload
        assert "metadata" in payload
        assert payload["metadata"]["archivo"] == "C-1101.xls"
        assert payload["metadata"]["n_filas_archivo"] == 42
        assert payload["metadata"]["n_filas_maestra"] == 40
        assert len(payload["extras"]) == 2
        assert payload["extras"][0]["orden"] == 41
