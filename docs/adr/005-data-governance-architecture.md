# ADR 005 — Data Governance Architecture (5 layers)

**Status**: Accepted
**Date**: 2026-05-31
**Deciders**: Gus

---

## Contexto

Aibenchef necesita una capa de gobierno de datos antes de aceptar clientes
multi-tenant pagantes:

- **Compliance Ley 29733 (Peru)**: audit log de quien toco que data.
- **Multi-tenant aislamiento**: un cliente NO debe ver data de otro,
  por accidente ni por bug.
- **Lineage**: cuando un parser cambia, saber que marts/dashboards se
  afectan antes de mergear.
- **Discoverability**: usuarios deben ver "ROE", "Cartera CAR" definidos
  en UI sin abrir el codigo del parser.
- **Calidad operativa**: tagging de columnas para deprecation,
  experimental, PII.

Databricks Unity Catalog cubre todo esto pero esta diseñado para empresas
con 100+ data engineers. Aibenchef es single-dev. Implementarlo entero es
overkill y tardaria 6 meses.

## Decision

Implementamos **5 capas minimas de gobierno** bajo un dominio nuevo
`lib/domains/governance/` y un schema Postgres dedicado `gov`. Cada capa
es independiente, cumple SRP, y se puede deshabilitar sin afectar a las
otras.

```
gov (Postgres schema)
├── audit_log         → eventos auditables inmutables
├── business_glossary → nombres humanos + descripciones por columna
├── lineage_snapshot  → grafo de dependencias (cache del manifest dbt)
├── tenant_membership → quien pertenece a que tenant
└── column_tags       → tags semanticos sobre columnas
```

```
lib/domains/governance/
├── audit/      → Capa 1: sink unificado
├── glossary/   → Capa 2: business glossary
├── lineage/    → Capa 3: lineage desde dbt
├── tenancy/    → Capa 4: RLS multi-tenant
├── tags/       → Capa 5: column tagging
└── index.ts    → facade publico
```

## Principios aplicados

### DDD (continuidad con ADR 004)
- `governance` es un **bounded context** con su propio language y modelo.
- No conoce nada de `informe`, `eeff`, `marts` — solo expone primitivas
  de gobierno que otros dominios consumen.

### SOLID
- **SRP**: cada submodulo hace UNA cosa (audit *solo* registra eventos).
- **OCP**: `AuditLogger`, `GlossaryReader`, `LineageReader` son
  interfaces. Extender = agregar implementacion, no modificar consumers.
- **LSP**: cualquier `AuditLogger` (Postgres, memoria, no-op para tests)
  es intercambiable.
- **ISP**: interfaces chicas y especificas — un consumer que solo lee
  glosario no depende del sink de audit.
- **DIP**: el dominio define los ports (interfaces). Los adapters
  (Postgres) viven en `infrastructure/` o como impl interna. Capas de
  arriba (API routes, UI) dependen de la interface, no del adapter.

### Seguridad por defecto
- **RLS activo** en TODAS las tablas `gov.*` desde la creacion (no
  opcional, no toggle).
- **audit_log inmutable**: NO UPDATE, NO DELETE policies. Append-only
  por diseño.
- **Tenant isolation**: helper `withTenantContext()` setea
  `SET LOCAL app.tenant_id` por request. Sin contexto = sin acceso.

### Escalabilidad
- Indices BRIN en `audit_log.created_at` (apend-only, miles/dia → BRIN
  > BTREE para storage).
- `audit_log` particionable por mes en futuro (PARTITION BY RANGE
  preparado, no aplicado V1).
- `lineage_snapshot` es cache; se regenera del manifest dbt sin tocar
  estado.
- Queries con LIMIT obligatorio.

### CMMI nivel 3 (Defined)
- Procesos documentados: este ADR + `.claude/rules/governance.md`.
- Standards organizacionales: nombres tags canonicos (`pii`,
  `deprecated`, etc.), categorias audit canonicas.
- Metricas: cobertura de audit (% endpoints sensibles registrados),
  cobertura RLS (% tablas multi-tenant con policy).
- Mejora continua: ADRs sucesivos cuando agreguemos capas o
  refinemos modelos.

## Consecuencias

Positivas:
- Compliance basico desde ya — no esperamos al primer cliente.
- Refactor futuro de UC-features no rompe consumers (interfaces estables).
- Tests independientes por capa.
- UI puede consumir cualquier capa sin acoplarse a Postgres.

Negativas / trade-offs aceptados:
- Schema `gov` extra → 5 tablas mas en el DWH (overhead ~MBs).
- Helper `withTenantContext()` debe usarse correctamente — error de uso
  = leak. Cubierto con tests integration.
- Glosario debe mantenerse a mano. No hay autodescubrimiento (V2).
- Lineage es snapshot, no real-time. Se recalcula con `dbt compile`.

## Alternativas descartadas

| Alternativa | Por que NO |
|---|---|
| Unity Catalog completo | Overkill para single-dev, 6 meses |
| Solo audit log sin RLS | Compliance OK pero leak posible al primer bug |
| RLS basado en schema-por-tenant | No escala >50 tenants (catalogue pollution) |
| Auditoria via triggers Postgres | Acopla a Postgres, dificil de testear |
| Lineage manual via comentarios | Imposible mantener sincronizado |

## Estado V1

- [x] Schema `gov` con 5 tablas + RLS + indices
- [x] 5 dominios bajo `lib/domains/governance/`
- [x] APIs REST minimas por capa
- [x] UI minima por capa (audit viewer, lineage graph, catalog enriquecido)
- [x] Tests por capa
- [x] Glossary seed inicial (~30 cuentas SBS desde aibenchef-sbs skill)

## Out of scope V1 (futuro)

- Column-level masking dinamico (V2 — cuando primer cliente Enterprise)
- Auto-classification ML de PII (no aplica — data publica)
- Federated query a otros DBs (no aplica)
- Workflow approval para cambios de schema (V3)
- Geo-replication / multi-region (V4)

## Referencias

- ADR 004 — DDD + standards
- Skill `.claude/skills/aibenchef-sbs/` — dominio SBS canonico (semilla
  para el glosario)
- Migration `V124` — schema gov
- Design doc `docs/design/data-governance-v1.md` — detalle por capa
