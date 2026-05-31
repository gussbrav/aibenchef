# Data Governance Rules — Aibenchef

> Reglas no negociables para trabajar con el dominio `governance`.
> Claude debe leerlas antes de tocar audit, glossary, lineage, tenancy o tags.

---

## Principio general

**Toda operacion sensible se audita. Todo dato se cataloga. Todo cliente
queda aislado por RLS. Toda columna critica tiene tag.**

Si una feature nueva toca data del cliente, debe contestar SI a las 4:

1. ¿El evento queda registrado en `gov.audit_log` via `recordAuditEvent()`?
2. ¿La tabla/columna nueva tiene entrada en `gov.business_glossary`?
3. ¿La tabla nueva tiene policy RLS multi-tenant si aplica?
4. ¿Las columnas PII / sensible / calculated estan tagged en `gov.column_tags`?

Si UNA respuesta es NO, el feature no se merge.

---

## Reglas por capa

### CAPA 1 — Audit

- **Toda escritura sensible** (cambios de schema, billing, cambios de
  rol, queries SQL en /sql, accesos a /aiben) debe llamar
  `recordAuditEvent()`.
- **Nunca insertar directo** en `gov.audit_log`. Solo via funcion
  `gov.record_audit_event` (SECURITY DEFINER) o el helper TypeScript.
- **audit_log es append-only**. NO escribir UPDATE ni DELETE policies.
  Si necesitas "borrar" un evento por error, marcalo via metadata
  `{"redacted": true}` con un evento nuevo.
- **Errores en log() NO se propagan**. El audit no debe romper la
  operacion principal — `try/catch` con `log.error` interno.
- **Categoria es enum canonico** (`AuditCategory`). No inventes
  categorias nuevas — agrega al enum + documenta + crea ADR.

### CAPA 2 — Glossary

- **Source-of-truth**: `gov.business_glossary` para UI/usuarios.
  `.claude/skills/aibenchef-sbs/SKILL.md` para Claude.
- **Sincronizacion bidireccional manual**: cuando agregas cuenta al
  skill, agregala al seed (`glossary/seed.ts`). Cuando agregas al seed,
  agregala al skill.
- **Descripcion obligatoria** para columnas nuevas que aparecen en UI
  (catalog, eeff inspector). Sin descripcion, no se muestra en la UI.
- **Castellano peruano** (tu/tienes/puedes). Mismo tono que el resto
  del proyecto.

### CAPA 3 — Lineage

- **NO inferir lineage de queries en runtime** (caro + ruidoso).
  Solo del manifest dbt.
- **Refresh manual** con `scripts/refresh_lineage.ts` despues de
  `dbt compile`. Futuro: hook en CI.
- **Read-mostly**: NO insertar edges a mano desde codigo. Solo via
  `replaceSnapshot()` transaccional.

### CAPA 4 — Tenancy

- **TODA query que toca tabla multi-tenant** debe ir dentro de
  `withRequestContext(ctx, ...)`. Sin contexto = sin filtrado = leak.
- **RLS NUNCA se DESACTIVA**. Si un test requiere bypass, usa rol
  privilegiado con `SET LOCAL`, no `ALTER TABLE DISABLE RLS`.
- **`tenant_id` es UUID en TODAS las tablas multi-tenant**. No mezclar
  con `slug` o nombre.
- **Membership obligatoria**: un usuario NO puede acceder a un tenant
  sin entrada en `gov.tenant_membership`. Validar antes de
  set-context.
- **GUCs son por-transaccion** (`SET LOCAL`). Nunca usar `SET` sin
  `LOCAL` — fugaria contexto entre requests del mismo connection.

### CAPA 5 — Tags

- **Vocabulario es enum canonico** (`ColumnTag`). NO free-text. Cambiar
  el set requiere migration + ADR.
- **Tag `pii`** dispara automaticamente masking en exports (V2 — por
  ahora documenta, no enmascara).
- **Tag `deprecated`** dispara warning en /catalog UI. Tests deben
  fallar si codigo nuevo usa columna deprecated (V2).

---

## Patrones SOLID en el dominio

### SRP
Cada subdominio hace UNA cosa. `audit/` NO sabe de tenants ni glossary.

### OCP
Para agregar audit a un endpoint nuevo: implementa `AuditLogger` o
llama `recordAuditEvent()`. Cero modificacion del dominio.

### LSP
`InMemoryAuditLogger` es 100% intercambiable con `PostgresAuditLogger`.
Tests usan in-memory, prod usa Postgres, contract identico.

### ISP
- `GlossaryReader` y `GlossaryWriter` son interfaces SEPARADAS.
  Consumers read-only no dependen de write.
- `LineageReader` y `LineageWriter` idem.

### DIP
Routes / UI dependen de interfaces (`AuditLogger`, `GlossaryReader`),
no de las clases Postgres. Adapter se inyecta via `getXxx()` que es
reemplazable con `setXxx()` en tests.

---

## Cuando agregar capa nueva o feature

1. Crear subdir `lib/domains/governance/<capa>/`
2. Definir `types.ts` con port (interface) + tipos publicos
3. Implementar adapter Postgres + adapter InMemory para tests
4. `index.ts` re-exporta tipos + getter singleton
5. Migration `Vxxx__governance_<capa>.sql` con tabla + RLS + indices
6. Tests del adapter InMemory (rapidos)
7. Tests del adapter Postgres marcados `@pytest.mark.integration` /
   `vitest.config integration` (con testcontainers)
8. ADR nueva `docs/adr/00X-governance-<capa>.md`
9. Actualizar este archivo de rules
10. Actualizar `docs/design/data-governance-v1.md`

---

## Errores comunes a evitar

| Error | Por que es mal | Como hacerlo bien |
|---|---|---|
| `db.execute(SELECT ... FROM gov.tenants)` sin contexto | RLS vacia el resultado en silencio | `withRequestContext(ctx, tx => tx.execute(...))` |
| `INSERT INTO gov.audit_log` directo | Bypassa la funcion + RLS check | `recordAuditEvent({category, action, ...})` |
| Tag custom en string | Rompe el enum + indices | Usar `ColumnTag` enum |
| `dbt` corrido sin refresh lineage | UI muestra grafo viejo | `scripts/refresh_lineage.ts` despues |
| Audit log dentro de transaccion principal | Si la txn rollback se pierde el evento | Llamar `recordAuditEvent()` despues del commit |

---

## CMMI compliance

Estas reglas + ADR 005 + design doc cubren CMMI nivel 3 (Defined):

- ✅ Procesos documentados (este archivo + ADRs)
- ✅ Estandares organizacionales (vocabularios canonicos)
- ✅ Tests por capa (unitarios + integration)
- ✅ Metricas medibles (audit coverage %, RLS coverage %)
- ✅ Mejora continua (ADRs sucesivos para refinement)

Nivel 4 (Quantitatively Managed) y nivel 5 (Optimizing) requieren
metricas estadisticas y mejora basada en data — futuro V2.
