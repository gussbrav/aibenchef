# AI Collaboration — como trabajar con Claude Code en Aibenchef

> Esta regla aplica a Claude Code y a cualquier otro agente que codee aca.
> Define el contrato de trabajo: que hace el humano, que hace la IA, donde
> esta la frontera.

---

## Reparto de responsabilidades

| Responsabilidad | Quien |
|---|---|
| Decision de hacer una feature | Humano (Gus) |
| Spec con RFs (Given/When/Then) | Humano + IA via `/sdd-feature` |
| Plan de implementacion (fases, dependencias) | IA, humano aprueba |
| Codigo de implementacion | IA |
| Tests (golden, property, integration) | IA, humano revisa filosofia |
| Migration SQL | IA, humano aprueba (siempre, sin excepcion) |
| Decision arquitectonica (ADR) | Humano, IA redacta |
| Verificar invariantes financieras | Humano (lee Excel canonico) |
| Merge a main | Humano |
| Deploy a prod | Humano |

**Regla**: cualquier cambio que tenga impacto financiero (parser EEFF,
formulas de ratios, calculo de TTM, migrations que tocan tablas con datos)
**requiere ojo humano** antes de mergear, no importa que CI pase.

---

## Antes de codear

### 1. Verificar, no asumir

Memoria existente:
[verify_never_assume](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/feedback_verify_never_assume.md)

Antes de codear formulas o mapeos, leer la fuente real:
- Cuentas SBS → `BASE EE.FF..xlsx`, `CONSOLIDADO BALANCE SBS.xlsx`,
  `CONSOLIDADO GYP SBS.xlsx`
- Indicadores → `CABECERAS DE PRINCIPALES INDICADORES SBS.xlsx`
- Codigos archivo → `Base de datos SBS.xlsx` sheet `Hoja2`
- Vistas marts → migration SQL real (no asumir nombres de columnas)

Si la fuente no existe / no es accesible, **detener y preguntar**, no
inventar.

### 2. Modo Plan obligatorio para features grandes

Si la tarea toma > 1 dia o > 5 archivos, **Claude debe entrar en plan mode
primero** y esperar aprobacion humana antes de codear. No empezar a editar
"para ver".

### 3. PR amarrado a issue

Memoria:
[pr_issue_linking](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/feedback_pr_issue_linking.md)

Toda PR debe llevar `Closes #N` en el body. Si no hay issue, crearlo primero
con `gh issue create`. PRs huerfanos no se mergean.

---

## Mientras codea

### 4. Una cosa por commit

No mezclar feature + refactor + fix. Si encontras un bug mientras codeas otra
cosa, abrir issue aparte, no meterlo al mismo PR.

### 5. Tests primero (cuando aplica)

Para bug fixes: escribir el test que reproduce el bug **antes** de fixearlo.
El test debe fallar sin el fix, pasar con el fix. Marcar con
`@pytest.mark.regression` y `# Bug ID: <commit-sha>`.

Para features nuevas: tests pueden ir junto, no necesariamente antes — pero
deben cumplir [`testing-philosophy.md`](testing-philosophy.md).

### 6. Migrations idempotentes

Memoria:
[drop_cascade_blast_radius](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/feedback_drop_cascade_blast_radius.md)

- `CREATE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
- Si haces `DROP ... CASCADE`, listar las vistas dependientes y restaurarlas
  en la misma migration
- Numeracion unica (ver `MIGRATIONS.md`)

---

## Despues de codear

### 7. CI verde es obligatorio

Memoria:
[always_check_ci](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/feedback_always_check_ci.md)

Despues de `git push`, correr `gh pr checks` automaticamente. Si rojo,
investigar y arreglar antes de pedir merge.

### 8. Sin trailer "Co-Authored-By"

Memoria:
[no_coauthor_trailer](C:/Users/ASUS/.claude/projects/d--PROYECTO-N8N-PALMA-RIO-CRM/memory/feedback_no_coauthor_trailer.md)

Commit messages no incluyen `Co-Authored-By: Claude`. El autor es Gus.

### 9. Documentar en el modulo, no en raiz

Features nuevas se documentan en el modulo que tocan
(`src/aibenchef_data/domains/<dominio>/README.md`), no creando .md en raiz.

---

## Modos de operacion

### Modo conversacional

Preguntas, exploracion, design discussion. Sin tools, sin codear. Respuesta
corta, opinable.

### Modo plan

Tarea grande, entrar a `EnterPlanMode`. Pensar arquitectura, dependencias,
fases. Esperar aprobacion. No codear hasta `ExitPlanMode`.

### Modo implementacion

Tarea aprobada, codear con TodoWrite para tracking. Marcar tasks completed
en el momento, no batch.

### Modo review

`/review-pr <numero>`. Revisar diff sin escribir codigo. Devolver 5 puntos
maximo, conciso.

### Modo eval

`/eval-parser`. Correr el golden dataset y reportar regresiones (entidad,
periodo, cuenta donde el output diverge).

---

## Cosas que NO hace la IA aca

- No commit + push sin que se lo pidan
- No mergear PRs (eso es humano)
- No aprobar reviews automaticos como humano
- No tocar `.env`, `settings.json`, credenciales
- No correr migrations contra prod sin doble confirmacion
- No borrar archivos en `BASES EXCEL/` (son fuente de verdad de Gus)
- No modificar tests existentes sin entender por que existen (leer docstring,
  buscar bug ID, decidir conscientemente)
