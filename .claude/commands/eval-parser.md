---
description: Corre el golden dataset del parser EEFF y reporta regresiones (entidad, periodo, cuenta donde diverge)
allowed-tools: Bash, Read
---

# /eval-parser

Corre el test del golden dataset (`tests/golden/`) contra el parser EEFF
actual y reporta donde diverge respecto al gold estandar de Gus
(`BASE EE.FF..xlsx`).

NO modifica nada. Solo lee y reporta.

## Que hacer

### 1. Verificar que el dataset existe

```bash
ls data-platform/tests/golden/eeff_golden.parquet
```

Si no existe, decirle al usuario:

> No hay golden dataset todavia. Generalo con:
> ```
> uv run python data-platform/scripts/build_golden_eeff.py
> ```

### 2. Correr el test golden

```bash
cd data-platform
uv run pytest tests/golden/test_eeff_golden.py -v --tb=short 2>&1 | tail -100
```

### 3. Reportar resultado

**Si todo OK:**

```
✅ Golden eval OK
- N samples verificados
- 0 divergencias
- Cobertura: X entidades, Y periodos, Z cuentas
```

**Si hay divergencias:**

```
⚠️  Golden eval: <N> divergencias detectadas

### Top divergencias (max 10 por relevancia)

| Entidad | Periodo | Cuenta | Parser | Gold | Delta % |
|---------|---------|--------|--------|------|---------|
| CMAC Arequipa | 202403 | A1_DISPONIBLE | 1234.5 | 1234.6 | 0.008% |
| ... |

### Patrones detectados

- <N> divergencias en cuenta X — sugiere bug en mapeo X
- <N> divergencias concentradas en periodo Y — sugiere cambio de plan SBS
- <N> divergencias en entidad Z — sugiere cabecera distinta

### Proximos pasos

1. Revisar las divergencias mas grandes primero (% delta)
2. Abrir issue con label `parser-regression`
3. Agregar test de regresion antes de fixear (testing-philosophy regla 5)
```

### 4. Si el test rompe por error (no por divergencia)

Diferenciar:

- **Error de import / setup**: probable que falten deps. Sugerir
  `uv sync --all-groups`.
- **Error en datos del golden**: el parquet esta corrupto. Re-generar.
- **Error en parser**: bug nuevo. Imprimir traceback corto.

## Lo que NO hacer

- NO fixear los bugs encontrados (solo reportar)
- NO actualizar el golden dataset automaticamente cuando hay divergencia
  (el golden es source of truth — si esta mal, hay que actualizarlo a mano
  con justificacion)
- NO marcar tests como skip / xfail para que pase
