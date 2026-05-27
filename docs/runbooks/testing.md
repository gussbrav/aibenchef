# Runbook — Testing

## Estructura

```
data-platform/tests/
├── conftest.py              # Fixtures globales: pg_container, fixtures_dir
├── fixtures/                # Archivos .xls de muestra (committeados)
│   ├── biff_utf16_corrupt.xls         # Regresion BIFF UTF-16
│   ├── biff_banca_old_layout.xls      # Regresion empresa col 1
│   └── biff_inverted_layout.xls       # Regresion layout 2009-2010
└── unit/                    # Tests rapidos, sin DB
    ├── test_xls_reader.py             # 5 formatos + detect_xls_format
    ├── test_layout_detection.py       # Detectores de cada importer
    ├── test_catalog.py                # SbsUrlBuilder, Periodo, etc
    ├── test_sbs_url.py
    └── test_cuenta.py
```

## Comandos

| Qué corre | Comando | Cuándo |
|---|---|---|
| Todos los tests (rapidos) | `uv run pytest -q` | Antes de commit |
| Solo unit (sin Docker) | `uv run pytest -m "not integration"` | Pre-push hook |
| Solo integration (con testcontainers) | `uv run pytest -m integration` | CI o local con Docker |
| Cobertura | `uv run pytest --cov --cov-report=term-missing` | Verificar % cubierto |
| Un test específico | `uv run pytest tests/unit/test_xls_reader.py::TestReadXlsXlsx -v` | Debug |

## Markers

```python
@pytest.mark.integration  # Requiere Docker (testcontainers)
@pytest.mark.slow         # Toma >2s — se omite en pre-push hook
```

## Patrón: test de regresión

Cada bug fix debe traer un test que falla SIN el fix y pasa CON él:

```python
class TestReadXlsBiffReal:
    def test_biff_se_lee_sin_excepcion(self, fixtures_dir: Path):
        """REGRESION: este archivo fallaba con 'illegal UTF-16 surrogate'."""
        p = fixtures_dir / "biff_utf16_corrupt.xls"
        sheets = read_xls(p)
        assert len(sheets) >= 1
```

El archivo de fixture queda commited en `tests/fixtures/`. Si el fix se revierte
o degrada, el test rompe y bloquea el merge.

## Fixtures con testcontainers Postgres

Para tests que tocan DB (importers idempotency, MV refresh, dw.* SQL):

```python
import pytest
import psycopg

@pytest.mark.integration
def test_idempotent_upsert(pg_dsn):
    with psycopg.connect(pg_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE t (id int primary key, v text)")
            cur.execute("INSERT INTO t VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET v=EXCLUDED.v")
            cur.execute("INSERT INTO t VALUES (1, 'b') ON CONFLICT (id) DO UPDATE SET v=EXCLUDED.v")
            cur.execute("SELECT v FROM t WHERE id=1")
            assert cur.fetchone()[0] == "b"
```

El Postgres efimero arranca **una sola vez por session**, se reutiliza entre tests.
Cada test debe limpiar su propia data (DROP TABLE en teardown o transacciones).

## Cobertura objetivo

| Módulo | Target | Estado actual |
|---|---|---|
| `parsing/xls_reader` | 90% | 85% ✅ |
| `parsing/value_objects` | 80% | 74% ⚠️  |
| `domains/loading/services/monthly_*` | 70% | TODO |
| `domains/loading/services/base_*` | 50% | TODO |

Ver porcentaje actual:

```sh
uv run pytest --cov=aibenchef_data --cov-report=html
open htmlcov/index.html
```

## Cómo agregar un test nuevo

1. **¿Toca DB?** → `tests/integration/` con `@pytest.mark.integration`
2. **¿Toca archivos `.xls`?** → fixture en `tests/fixtures/`, test en `tests/unit/`
3. **¿Es solo lógica pura?** → `tests/unit/` sin fixtures

Naming: `test_<modulo>.py` con clases `Test<Feature>` y métodos
`test_<comportamiento_esperado>()`.
