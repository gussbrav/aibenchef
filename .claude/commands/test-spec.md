---
description: Disena un test antes de codearlo, validando contra testing-philosophy.md
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# /test-spec <descripcion del test o RF#>

NO escribe el test directamente. Te fuerza a responder 3 preguntas que
validan si vale la pena escribir el test segun
[`testing-philosophy.md`](../rules/testing-philosophy.md).

Si las respuestas son debiles, el test no se escribe.

## Argumentos

- `$ARGUMENTS` = descripcion corta del test o referencia a RF# en un spec.
  Ej: `parser EEFF maneja footnote 1/ con espacio` o `RF3 de observabilidad-v1`.

## Que hacer paso a paso

### 1. Leer testing-philosophy.md primero

```bash
cat .claude/rules/testing-philosophy.md
```

### 2. Hacer las 3 preguntas obligatorias con AskUserQuestion

1. **¿Si rompo el codigo, este test falla? ¿En que linea exacta?**
   - Si la respuesta es "no se" o "tal vez" — el test no se escribe.
   - Si la respuesta es "en cualquier lado" — pedir mas precision.

2. **¿Que invariante del dominio o comportamiento del usuario verifica?**
   - "que la funcion existe" → no
   - "que retorna dict" → no
   - "que activos == pasivos + patrimonio" → si
   - "que el footnote 1/ no se carga como cuenta contable" → si

3. **¿Que tipo de test es?**
   Opciones: `golden | property | snapshot | integration | regression | unit`
   - Si no encaja en ninguna → probablemente no aporta. Pedir reconsiderar.

### 3. Si las 3 respuestas son solidas, generar el test

Segun el tipo:

- **golden**: agregar fila a `tests/golden/<dominio>.parquet` + iterar en el
  test existente. NO crear test nuevo si ya existe el iterador.
- **property**: agregar `@given` + `@settings(max_examples=N)` en
  `tests/property/test_<dominio>.py`.
- **snapshot**: agregar caso en `tests/integration/test_<vista>.py` con
  `pg_container` fixture.
- **regression**: en `tests/unit/` con docstring `REGRESION issue #N` y
  `@pytest.mark.regression`.
- **integration**: marcar con `@pytest.mark.integration`.
- **unit**: solo si NO encaja en ninguna de las anteriores y es comportamiento
  puro (parser, normalizacion, etc).

### 4. Antes de cerrar, correr el test

```bash
uv run pytest <path> -v
```

- Debe **pasar** si el codigo esta bien.
- Para regresiones: debe **fallar** si revertis el fix. Verificar haciendo
  `git stash` del fix temporalmente.

### 5. Si fallan las preguntas de paso 2

Decirle al usuario claramente:

> El test propuesto no cumple la filosofia (`.claude/rules/testing-philosophy.md`).
>
> Razones:
> - <razon>
>
> Opciones:
> a) Reformular el test para que verifique una invariante real
> b) No escribirlo — el comportamiento ya esta cubierto por <otro test>
> c) Cambiar el codigo en lugar del test (si el codigo no es testeable, el
>    problema es el codigo)

No insistir. Si el usuario quiere agregar el test debil igual, dejarlo y
agregar TODO comment `# TODO: test debil — replantear con golden/property`.

## Lo que NO hacer

- NO escribir tests `assert is not None`, `assert isinstance(x, dict)`
- NO mockear DB (usar testcontainers)
- NO mockear el filesystem para parsers (usar `tests/fixtures/`)
- NO subir coverage por subirlo — coverage es consecuencia, no objetivo
