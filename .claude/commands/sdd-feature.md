---
description: Spec-driven feature — convierte idea vaga en spec con RFs en Given/When/Then + issue GitHub padre + sub-issues
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---

# /sdd-feature <nombre-corto>

Genera un spec ejecutable para una feature nueva. NO empieza a codear.
Termina con un design doc en `docs/specs/` + issue padre en GitHub + sub-issues
listos para arrancar.

## Argumentos

- `$ARGUMENTS` = nombre corto de la feature (kebab-case). Ej: `observabilidad-v1`,
  `parser-castigos`, `dashboard-ratios-trimestral`.

Si el usuario no paso argumento, preguntar antes de seguir.

## Que hacer paso a paso

### 1. Hacer las 5 preguntas con AskUserQuestion

No saltarte ninguna. Las 5 son obligatorias:

1. **Problema**: ¿Que problema resuelve esta feature? (1 frase)
2. **Criterio de exito medible**: ¿Como sabemos que funciono? (metrica concreta)
3. **Superficie tocada**: ¿Que servicios/tablas/endpoints/UI toca?
4. **Riesgo**: ¿Cual es el peor caso si sale mal? (data corrupta? caida? leak?)
5. **Deadline o dependencia**: ¿Hay fecha tope o depende de otra cosa?

### 2. Generar `docs/specs/<nombre>.md`

Estructura obligatoria:

```markdown
# Feature: <Nombre Humano>

**Estado**: DRAFT
**Autor**: <git config user.name>
**Fecha**: <hoy YYYY-MM-DD>
**Issue padre**: (se llena despues de paso 3)

## 1. Problema
<respuesta pregunta 1>

## 2. Criterio de exito
<respuesta pregunta 2>

## 3. Superficie
<respuesta pregunta 3>

## 4. Riesgo
<respuesta pregunta 4>

## 5. Deadline / dependencias
<respuesta pregunta 5>

## 6. Requisitos funcionales (RFs)

> Cada RF se convertira en un sub-issue y en un test. Si no podes
> expresarlo como Given/When/Then, no es un RF — es prosa.

| RF# | Given | When | Then |
|-----|-------|------|------|
| RF1 | <estado inicial> | <accion> | <resultado observable> |
| RF2 | ... | ... | ... |

(Inferir 3-8 RFs a partir de las respuestas. Si no tenes suficiente
informacion, hacer 1-2 preguntas adicionales antes de inventar RFs.)

## 7. Fases sugeridas

| Fase | Incluye RFs | Objetivo |
|------|-------------|----------|
| 1 | RF1, RF2 | <ej: schema + tests unitarios> |
| 2 | RF3 | <ej: endpoint> |
| 3 | RF4, RF5 | <ej: UI> |

## 8. Tests requeridos (segun testing-philosophy.md)

- [ ] RFs con invariantes del dominio: property-based (Hypothesis)
- [ ] RFs con parsing/transformacion: golden dataset
- [ ] RFs con SQL: snapshot test con testcontainers
- [ ] RFs con UI: e2e Playwright (si aplica)

## 9. Out of scope

<que NO entra en esta feature, para evitar scope creep>
```

### 3. Crear issue padre en GitHub

```bash
gh issue create \
  --title "Feature: <Nombre Humano>" \
  --body "$(cat <<'EOF'
Spec: docs/specs/<nombre>.md

## Resumen
<problema en 1 frase>

## RFs
- [ ] RF1: <descripcion corta>
- [ ] RF2: ...
- [ ] RF3: ...

## Fases
- [ ] Fase 1
- [ ] Fase 2

## Criterio de exito
<metrica>
EOF
)"
```

Capturar el numero del issue creado. Actualizar el campo `Issue padre` del
spec markdown con el numero (ej. `**Issue padre**: #142`).

### 4. Listar comandos para sub-issues (no ejecutarlos automaticamente)

Imprimir al usuario los comandos `gh issue create` listos para pegar, uno por
RF. Formato:

```bash
gh issue create --title "RF1: <titulo>" --body "Parent: #<padre>

Given: <given>
When:  <when>
Then:  <then>

Test type: <golden|property|snapshot|unit>
"
```

Dejar que el usuario decida cuales crear ya y cuales depues.

### 5. Output final

Resumir al usuario:

- Path al spec creado
- URL del issue padre
- N comandos sub-issue listos para pegar
- Proximo paso sugerido: `/test-spec` para el primer RF antes de codear

## Lo que NO hacer

- NO codear la feature (eso es `/implement` u otra cosa)
- NO crear los sub-issues automaticamente (el usuario decide)
- NO inventar RFs sin las respuestas a las 5 preguntas
- NO saltarte la tabla de RFs aunque sea chico (asi sea 1 RF, va en tabla)
