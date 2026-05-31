# Golden Dataset — Aibenchef

## Que es

Un parquet con la verdad financiera SBS extraida del Excel canonico de Gus
(`D:\PROYECTO\SBS\BASES EXCEL\BASE EE.FF..xlsx`).

Es la **fuente de verdad** contra la cual se valida el parser EEFF y
cualquier transformacion que pretenda reproducir los valores oficiales.

## Por que existe

Los bugs historicos del parser (issue #13 CMAC TOTAL=TOTAL, issue #15
footnote SBS) hubieran sido detectados en el dia 1 si existian tests que
comparaban contra el gold standard. Sin golden, el parser podia compilar,
pasar tests unitarios sinteticos, y seguir produciendo numeros equivocados
durante semanas.

Filosofia completa: [`.claude/rules/testing-philosophy.md`](../../.claude/rules/testing-philosophy.md).

## Generar / regenerar

```bash
cd data-platform
uv run python scripts/build_golden_eeff.py
```

Opciones utiles:

```bash
# Mas muestras (~50 por tipo_entidad distribuidas en anios)
uv run python scripts/build_golden_eeff.py --samples-per-grupo 50

# Generar TODO (sin muestreo) — parquet grande
uv run python scripts/build_golden_eeff.py --samples-per-grupo 0

# Otro seed para reproducibilidad
uv run python scripts/build_golden_eeff.py --seed 123

# Source en otro path
uv run python scripts/build_golden_eeff.py --source /otro/path/BASE.xlsx
```

## Estructura del parquet

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| empresa_sbs | str | Nombre oficial SBS (ej. "Caja Arequipa") |
| nomb_correg | str | Nombre corregido / canonico (ej. "CMAC Arequipa") |
| tipo_entidad | str | BANCOS / FINANCIERAS / CAJAS / CRACS / EDPYMES |
| periodo | int64 | YYYYMM (ej. 202403) |
| moneda | str | MN / ME / TOTAL |
| tipo_estado | str | "balance" o "resultados" |
| cuenta_codigo | str | Codigo regulatorio (ej. "A1.1") |
| cuenta_nombre | str | Nombre humano de la cuenta (ej. "Caja") |
| valor_esperado | float64 | Valor del Excel canonico |

## Cuando actualizar el gold

**Updatear el gold (regenerar el parquet) cuando:**
- Gus actualiza `BASE EE.FF..xlsx` con nuevos periodos
- Se agrega una entidad nueva al Excel canonico
- Se corrige un valor erroneo en el canonico

**NO updatear el gold cuando:**
- El parser produce un numero distinto al gold → eso es bug del parser, NO
  del gold. El gold es la verdad.
- "Para que pase el test" — eso es lo opuesto de lo que el golden hace.

## Como lo usan los tests

Los tests en [`test_eeff_golden.py`](test_eeff_golden.py) leen el parquet y:

1. Verifican invariantes financieras del gold mismo (sanity check del oraculo)
2. (V2 — pendiente) Comparan contra el output del parser EEFF en cada
   (entidad, periodo, moneda)

Para V2 hace falta integration con Postgres (testcontainers) porque el
parser inserta a `raw.eeff_observacion` y luego se lee de ahi.

## Si el archivo es muy grande

El parquet versionado en git tiene tamano razonable (~5-15 MB con seed=42).
Si en algun momento crece (>50 MB), considerar:
- Excluir del repo y bajarlo desde S3/MinIO en CI
- Reducir samples_per_grupo
- Comprimir con `zstd` en vez de `snappy`
