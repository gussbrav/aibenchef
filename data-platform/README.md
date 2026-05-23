# data-platform

Servicio Python para ingesta y procesamiento de datos publicos SBS.

## Estructura (DDD)

```
data-platform/
├── pyproject.toml
├── seeds/
│   └── entidades.json              <- catalogo seed (codigo_sbs, nombre, grupo)
├── src/aibenchef_data/
│   ├── __init__.py
│   ├── env.py                      <- pydantic-settings
│   ├── cli.py                      <- entrypoint (aibenchef ...)
│   ├── domains/
│   │   ├── shared/                 <- logger, errors, Result
│   │   ├── catalog/                <- entidades, topicos, periodos (Fase 1.2 ✓)
│   │   ├── scraping/               <- descarga SBS (Fase 1.3)
│   │   ├── parsing/                <- .xls -> pydantic (Fase 1.4)
│   │   └── loading/                <- raw.* postgres (Fase 1.5)
│   └── infrastructure/
│       ├── db.py                   <- psycopg async pool
│       └── storage.py              <- local fs (despues MinIO)
├── dbt/                            <- dbt project (Fase 1.6)
├── tests/
└── .env.example
```

## Setup local

```bash
cd data-platform
uv sync
cp .env.example .env  # editar DATABASE_URL si hace falta
uv run aibenchef --help
```

## Comandos disponibles

### Diagnóstico
```bash
uv run aibenchef db ping
uv run aibenchef db migrate          # aplica migraciones SQL pendientes
uv run aibenchef db refresh-mvs      # refresca todas las materialized views
```

### Catálogo
```bash
uv run aibenchef catalog list-entidades
uv run aibenchef catalog list-entidades --grupo cmac
uv run aibenchef catalog show-topicos
uv run aibenchef catalog periodo 202404
```

### Ingesta de bases consolidadas (BASES EXCEL/)

Estos comandos cargan los XLSX consolidados del usuario a `raw.*` con UPSERT
idempotente. Re-correr con archivo actualizado actualiza solo lo cambiado.

```bash
# EEFF (BG + ER) - 5M filas, 18 años de historia
uv run aibenchef import base-eeff "/path/BASES EXCEL/BASE EE.FF..xlsx"

# COLOCACIONES (cartera de creditos) - 70K filas
uv run aibenchef import base-colocaciones "/path/BASES EXCEL/BASE COLOCACIONES.xlsx"

# DEPOSITOS - 27K filas
uv run aibenchef import base-depositos "/path/BASES EXCEL/BASE DEPÓSITOS.xlsx"

# CASTIGOS (write-offs) - 62K filas
uv run aibenchef import base-castigos "/path/BASES EXCEL/BASE CASTIGOS.xlsx"
```

Después de cargar, refrescar marts:
```bash
uv run aibenchef db refresh-mvs
```

### Estado actual de la DB (mayo 2026)

| Tabla | Filas | Periodos | Notas |
|---|---|---|---|
| `raw.eeff_observacion` | 5,021,181 | 200801 → 202603 | mensual via monthly-eeff |
| `raw.colocaciones_observacion` | 70,440 | 200801 → 202303 | snapshot |
| `raw.depositos_observacion` | 27,291 | 200905 → 202303 | snapshot |
| `raw.castigos_observacion` | 61,645 | 200910 → 202303 | snapshot |
| `raw.patrimonio_efectivo` | 5,185 | 201501 → 202303 | Tier 1/2/3 Basilea |
| `raw.ratio_liquidez` | 3,873 | 201601 → 202303 | MN + ME |
| `raw.ratio_capital_global` | 5,706 | 201501 → 202303 | RCG Basilea III |
| `raw.personal_observacion` | 10,275 | 200801 → 202303 | Headcount |
| `raw.clientes_ahorros` | 38,075 | 200905 → 202303 | # clientes por producto |
| `raw.clientes_creditos` | 83,345 | 200801 → 202303 | # clientes por producto |
| `raw.tasas_activas` | 412,482 | 201601 → 202303 | Long fmt: segmento × plazo |
| `raw.creditos_distrito` | 329,338 | 201201 → 202303 | Cartera por distrito |
| `raw.creditos_depositos_oficina` | ~1,037,695 | 201301 → 202303 | Por oficina (~granular max) |
| **TOTAL** | **~7.1M filas** | 18 años | |

### Comandos para cargar todo

```bash
uv run aibenchef import base-eeff "/path/BASE EE.FF..xlsx"
uv run aibenchef import base-colocaciones "/path/BASE COLOCACIONES.xlsx"
uv run aibenchef import base-depositos "/path/BASE DEPÓSITOS.xlsx"
uv run aibenchef import base-castigos "/path/BASE CASTIGOS.xlsx"
uv run aibenchef import base-patrimonio "/path/BASE PATRIMONIO EFECTIVO.xlsx"
uv run aibenchef import base-ratio-liquidez "/path/BASE_RATIO_LIQUIDEZ.xlsx"
uv run aibenchef import base-rcg "/path/BASE_RCG.xlsx"
uv run aibenchef import base-personal "/path/BASE PERSONAL.xlsx"
uv run aibenchef import base-clientes-ahorros "/path/BASE CLIENTES AHORROS.xlsx"
uv run aibenchef import base-clientes-creditos "/path/BASE CLIENTES CRÉDITOS.xlsx"
uv run aibenchef import base-tasas-activas "/path/BASE TASAS ACTIVAS.xlsx"
uv run aibenchef import base-creditos-distrito "/path/BASE_Creditos_por_tipo_distrito.xlsx"
uv run aibenchef import base-oficinas "/path/CRÉDITOS Y DEPÓSITOS POR OFICINAS.xlsx"
uv run aibenchef db refresh-mvs
```

Marts disponibles:
- `marts.mv_eeff_ratios` — ratios financieros (ROA, ROE, morosidad, etc.)
- `marts.mv_eeff_balance_ancho` — balance general en formato wide
- `marts.mv_eeff_resultados_ancho` — estado de resultados en formato wide
- `marts.mv_colocaciones_resumen` — cartera por entidad/producto + ratios mora
- `marts.mv_colocaciones_por_tipo` — agregado por tipo de entidad
- `marts.mv_depositos_resumen` — depósitos por entidad/producto/segmento
- `marts.mv_castigos_resumen` — write-offs por entidad/producto

### Monitoreo de cambios SBS

La SBS puede re-publicar archivos con correcciones (ej: publica EEFF abril
el 10/05 y los reemplaza el 15/05). Para detectar cambios:

1. Hash SHA256 de cada archivo se calcula al cargar (almacenado en
   `raw.archivos_descargados`)
2. Si el hash cambia para el mismo nombre/periodo → re-ingesta automática
3. UPSERT con `ON CONFLICT DO UPDATE` reemplaza solo los valores que cambiaron

## Tests

```bash
uv run pytest
uv run ruff check .
uv run mypy src/
```
