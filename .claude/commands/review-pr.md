---
description: Revisa un PR del repo a demanda, sin escribir codigo, devuelve max 5 puntos
allowed-tools: Bash, Read, Grep, Glob
---

# /review-pr <numero>

Revisa un PR concreto. NO escribe codigo. NO mergea. Devuelve maximo 5 puntos
en orden de severidad.

## Argumentos

- `$ARGUMENTS` = numero del PR (ej. `87`) o URL completa.

Si no se pasa, listar PRs abiertos con `gh pr list` y preguntar cual.

## Que hacer paso a paso

### 1. Traer el diff completo

```bash
gh pr view $ARGUMENTS --json title,body,files,additions,deletions,commits
gh pr diff $ARGUMENTS
```

### 2. Leer reglas del proyecto que aplican

Antes de revisar, ojear:

- `.claude/rules/code-style.md`
- `.claude/rules/testing-philosophy.md`
- `.claude/rules/definition-of-done.md`
- `.claude/rules/ai-collaboration.md`

### 3. Aplicar checklist de severidad

En orden de prioridad — si encontras algo en categoria N, no buscar en N+1
hasta resolver:

**Severidad 1 — bloquea merge**
- Riesgo de data corrupta en prod (migration sin idempotencia, formula
  financiera mal, perdida de campos)
- Secret commiteado (.env, password, token)
- Bug logico claro en el diff
- Test que valida comportamiento equivocado

**Severidad 2 — pedir cambio antes de merge**
- Test que pasa por accidente (no cumple `testing-philosophy.md`)
- Falta test para invariante critica tocada
- DDL no idempotente
- Schema cambia sin migration
- Funcion publica cambia signature sin nota de compatibilidad

**Severidad 3 — sugerencia, no bloquea**
- Naming inconsistente con `code-style.md`
- Falta docstring en funcion publica nueva
- Comentario "TODO/FIXME" sin issue linkeado
- Refactor oportunista mezclado con fix (separar en commits)

**Severidad 4 — opinion / nit**
- Estilo (lo arregla ruff)
- Preferencia personal

### 4. Devolver el review

Formato estricto:

```
## Review PR #<numero>: <titulo>

**Veredicto**: APROBAR | PEDIR CAMBIOS | BLOQUEAR

### Hallazgos (max 5)

1. **[SEV<N>]** <archivo:linea> — <descripcion concisa>
   Que cambiar: <accion concreta>
2. ...

### Lo que esta bien

<1-2 lineas, solo si vale la pena reconocer algo concreto>
```

Limites:
- Maximo 5 hallazgos. Si hay mas, priorizar y decirlo: "Hay 8 issues
  detectados, listo los 5 mas criticos."
- Maximo 1 frase por hallazgo + 1 frase de accion.
- NO comentar nits si hay severidad 1 o 2 pendientes.
- NO escribir poemas, summaries largos, walkthrough, NADA decorativo.

### 5. NO postear el review en GitHub automaticamente

Devolverselo al usuario. El decide si lo postea con `gh pr comment` o lo usa
para conversar.

## Lo que NO hacer

- NO mergear el PR aunque CI este verde
- NO aprobar review en GitHub (solo humano)
- NO escribir codigo "para arreglarlo" — solo apuntar el problema
- NO inventar issues si el diff es trivial — decir "LGTM, sin hallazgos"
