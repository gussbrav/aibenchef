# Design Doc — Data Governance V1

**Status**: Implemented
**Date**: 2026-05-31
**Authors**: Gus
**Related**: [ADR 005](../adr/005-data-governance-architecture.md),
[`.claude/rules/governance.md`](../../.claude/rules/governance.md)

---

## 1. Problema

Aibenchef necesita gobierno de datos antes de aceptar clientes
multi-tenant. Sin gobierno:

- No hay audit trail compliance (Ley 29733 Peru).
- Riesgo de cross-tenant leak en el primer bug.
- Usuarios no entienden que significa `cta_17` sin abrir el codigo.
- Cuando un parser cambia, no se sabe que marts/dashboards rompen.
- Columnas PII / experimental / deprecated no tienen marca visual.

Databricks Unity Catalog cubre todo esto, pero es overkill para single-dev.

## 2. Objetivo V1

Implementar 5 capas minimas de gobierno que cubran ~80% del valor real
de Unity Catalog para nuestro caso, con principios DDD + SOLID y
schemas + interfaces estables para extender despues.

## 3. Arquitectura

### 3.1 Bounded context

`governance/` es un bounded context dedicado. NO conoce de `informe`,
`eeff`, `marts`. Solo expone primitivas que otros dominios consumen.

```
apps/web/lib/domains/governance/
├── audit/      Capa 1
├── glossary/   Capa 2
├── lineage/    Capa 3
├── tenancy/    Capa 4
├── tags/       Capa 5
└── index.ts    Facade publico
```

### 3.2 Schema Postgres

Schema dedicado `gov` con 5 tablas + 1 funcion + 1 vista:

```
gov/
├── audit_log              (append-only, RLS, BRIN sobre occurred_at)
├── business_glossary      (UNIQUE schema+table+column, FTS spanish)
├── lineage_snapshot       (UNIQUE source+target+relation)
├── tenants                (master de clientes/orgs)
├── tenant_membership      (user <-> tenant)
├── column_tags            (enum CHECK constraint)
├── record_audit_event()   (SECURITY DEFINER, unica forma de insertar audit)
└── audit_log_recent       (vista 30 dias con tenant joined)
```

### 3.3 Ports (interfaces)

Aplicacion del Dependency Inversion Principle. Las capas de arriba
dependen de interfaces, no de adapters Postgres.

| Capa | Ports |
|---|---|
| audit | `AuditLogger` |
| glossary | `GlossaryReader`, `GlossaryWriter` (ISP) |
| lineage | `LineageReader`, `LineageWriter` |
| tenancy | `TenantService` + helper `withRequestContext` |
| tags | `ColumnTagService` |

### 3.4 Adapters

Cada capa tiene 2 adapters:

- **Postgres**: produccion, lee/escribe `gov.*`.
- **InMemory**: tests unitarios, sin DB.

`setXxx()` permite override en tests.

### 3.5 Seguridad

**RLS activa en todas las tablas `gov.*`** desde V124. Policies:

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| audit_log | actor o admin | via funcion SD | denied | denied |
| business_glossary | todos | admin | admin | admin |
| lineage_snapshot | todos | admin | admin | admin |
| tenants | miembros o admin | admin | admin | admin |
| tenant_membership | el user o admin | admin | admin | admin |
| column_tags | todos | admin | admin | admin |

Configuracion del contexto del request via 3 GUCs:

```sql
SET LOCAL app.user_id = '<id>';
SET LOCAL app.tenant_id = '<uuid>';
SET LOCAL app.is_admin = 'true' | 'false';
```

Helper TypeScript `withRequestContext(ctx, fn)` los setea dentro de una
transaccion y los limpia al hacer commit/rollback.

## 4. Capa 1 — Audit Log

### Modelo

```typescript
type AuditEventInput = {
  category: AuditCategory;     // enum canonico (8 valores)
  action: string;              // libre, ej "login", "query_run"
  severity?: AuditSeverity;    // debug|info|warn|error|critical
  actorId?: string | null;
  actorEmail?: string | null;
  tenantId?: string | null;
  resource?: string | null;    // ej "marts.mv_eeff_balance_ancho"
  metadata?: Record<string, unknown>; // JSONB, max 16KB
  payloadHash?: string | null; // sha256 para dedup
  source?: AuditSource;
  ipAddress?: string | null;
  traceId?: string | null;
};
```

### Uso

```typescript
import { recordAuditEvent } from "@/lib/domains/governance";

await recordAuditEvent({
  category: "ai_providers",
  action: "update_baseurl",
  severity: "info",
  actorId: userId,
  resource: "provider:ollama",
  metadata: { old: oldUrl, new: newUrl },
});
```

### Decisiones

- **Append-only**: integridad por diseño.
- **SECURITY DEFINER function**: unico path de INSERT bypass RLS.
- **BRIN index sobre `occurred_at`**: 1000x mas pequeño que BTREE para
  append-only.
- **fire-and-forget**: errores en log NO rompen la operacion principal.

## 5. Capa 2 — Business Glossary

### Modelo

Una entrada por tabla (`column_name = NULL`) o por columna especifica
(`column_name = 'cta_17'`).

```typescript
type GlossaryEntry = {
  schemaName: string;
  tableName: string;
  columnName: string | null;
  displayName: string;     // "Utilidad Neta YTD"
  description: string;
  category: GlossaryCategory;
  appliesTo: string[];     // ej ['BANCOS','CMAC']
  formula: string | null;
  exampleUsage: string | null;
  source: string | null;
};
```

### Seed inicial

`glossary/seed.ts` tiene ~25 entradas canonicas derivadas del skill
`aibenchef-sbs/SKILL.md`. Cubren:

- `marts.mv_eeff_balance_ancho` + columnas dim
- `marts.mv_eeff_resultados_ancho` + cuentas principales (cta_1, cta_2, cta_17)
- `marts.v_kpis_anuales_entidad` + `utilidad_ttm`, promedios 12m
- Ratios (`roe`, `roa`, `ratio_mora`, `cobertura_car`)
- `raw.eeff_observacion`, `raw.archivos_descargados`
- `gov.audit_log` (meta)

### Discoverability

Full-text search en castellano via GIN index sobre
`to_tsvector('spanish', display_name || description)`.

## 6. Capa 3 — Lineage

### Source de verdad

`dbt manifest.json`. Path tipico: `data-platform/dbt/target/manifest.json`.

### Pipeline

```
dbt compile → manifest.json → parseManifest() → LineageWriter.replaceSnapshot()
                                                       ↓
                                          gov.lineage_snapshot (cache)
                                                       ↓
                                          LineageReader.getGraph(node) → UI
```

### Query

`getGraph({node, upstreamDepth, downstreamDepth})` devuelve subgrafo
focal con N saltos en ambas direcciones. Recursive CTE en Postgres.

### Out of scope V1

- Visualizacion D3/react-flow (UI minima en V1).
- Auto-refresh en CI (futuro).
- Lineage de queries ad-hoc (las del SQL workbench).

## 7. Capa 4 — Tenancy

### Modelo

```
gov.tenants (id, name, slug, plan, status, ...)
gov.tenant_membership (tenant_id, user_id, role)
```

Roles: `owner > admin > editor > viewer`.

### RLS policy template (para tablas multi-tenant futuras)

```sql
ALTER TABLE app.<tabla> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <tabla>_tenant_isolation ON app.<tabla>
  FOR ALL
  USING (
    coalesce(current_setting('app.is_admin', true), 'false') = 'true'
    OR tenant_id::text = coalesce(current_setting('app.tenant_id', true), '')
  );
```

### Helper

`withRequestContext(ctx, fn)` abre una transaccion, setea los 3 GUCs
con `SET LOCAL`, ejecuta `fn(tx)`, y hace commit/rollback. Garantiza
que el contexto no filtra entre requests del mismo connection pool.

### Tenant default

V124 seed inyecta tenant `default` (UUID `00000000-...-001`) para
operar en modo single-tenant hasta tener clientes pagantes.

## 8. Capa 5 — Column Tags

### Vocabulario canonico

8 tags fijos: `pii, sensitive, calculated, deprecated, experimental,
public, regulatory, financial`. Enum + CHECK constraint en Postgres.

### Modelo

```sql
gov.column_tags (id, schema_name, table_name, column_name, tag, note, set_by, set_at)
UNIQUE (schema_name, table_name, column_name, tag)
```

Una columna puede tener N tags (uno por categoria).

### Uso futuro (V2)

- Tag `pii` → auto-mask en exports.
- Tag `deprecated` → warning en `/catalog` UI + falla CI si codigo nuevo usa.
- Tag `experimental` → no usable en panel cliente, solo admin.

V1 solo persiste y permite consultar.

## 9. APIs REST (V1 minimas)

| Endpoint | Capa | Que hace |
|---|---|---|
| GET /api/v1/governance/audit-log | 1 | Lista con filtros |
| POST /api/v1/governance/audit-log | 1 | Solo admin, manual logging |
| GET /api/v1/governance/glossary | 2 | Lista + search |
| PUT /api/v1/governance/glossary/:schema/:table/:column? | 2 | Upsert |
| GET /api/v1/governance/lineage?node=X | 3 | Subgrafo |
| GET /api/v1/governance/tenants | 4 | Lista del user |
| GET /api/v1/governance/tags?schema=X&table=Y | 5 | Lista de la columna |
| POST /api/v1/governance/tags | 5 | Agrega tag |
| DELETE /api/v1/governance/tags/:id | 5 | Quita tag |

(V1 puede no implementar todas — minimo viable es audit-log + glossary.)

## 10. UI

### V1 minima

- `/dashboard/admin/audit` — lista de eventos con filtros (categoria,
  severity, fecha, actor).
- `/dashboard/admin/glossary` — explorer + busqueda + editor.
- `/dashboard/catalog` — extender con tags + descripciones del glossary.

### V2 futuro

- `/dashboard/admin/lineage` — grafo visual D3/react-flow.
- `/dashboard/admin/tenants` — manage tenants/memberships.

## 11. Metricas (CMMI nivel 3+)

| KPI | Target V1 | Como medir |
|---|---|---|
| % endpoints sensibles con audit | >80% | grep + manual review |
| % tablas multi-tenant con RLS | 100% | query a pg_policies |
| Cobertura glossary (% columnas de marts.*) | >50% | count rows vs columns |
| Tiempo de query audit_log p95 | <100ms | pg_stat_statements |
| Cobertura tests dominio | >80% | vitest --coverage |

## 12. Out of scope V1 (futuro V2/V3)

- Column-level masking dinamico (V2 — primer cliente Enterprise)
- Auto-classification ML de PII (no aplica — data publica regulatoria)
- Federated queries cross-DB (no aplica)
- Workflow approval para cambios de schema (V3)
- Geo-replication / multi-region (V4 — primero crecer)
- Visual lineage graph (V2 — react-flow)
- Tenants UI completa (V2 — antes del primer cliente)
- Auto-refresh lineage en CI (V2)

## 13. Riesgo y mitigacion

| Riesgo | Mitigacion |
|---|---|
| RLS mal aplicado leaks data | Tests integration por tabla, contract obligatorio |
| Audit log no escala (millones de filas) | Particion por mes preparada (no aplicada V1) |
| Glossary se queda desactualizado | Skill `aibenchef-sbs` como source paralelo + sync manual |
| Lineage muestra estado viejo | Refresh manual + futuro hook CI |
| Tag enum se rompe | Migration + ADR explicito para cambios |

## 14. Roll-out plan

- [x] V124 migration aplicada → schema `gov` existe en prod
- [x] Dominio `governance/` con 5 capas + tests unitarios
- [x] Seed inicial glossary
- [ ] API routes implementadas (V1.1)
- [ ] UI viewer audit + glossary (V1.2)
- [ ] Documentar en CLAUDE.md la regla "todo endpoint sensible audita" (V1.3)
- [ ] Integrar audit en endpoints existentes (V1.4)
- [ ] CI check: nuevas tablas con `tenant_id` requieren RLS policy (V2)
