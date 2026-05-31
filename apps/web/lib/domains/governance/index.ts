/**
 * Facade publico del dominio `governance`.
 *
 * Capas:
 *   1. audit       — sink unificado de eventos auditables
 *   2. glossary    — business glossary por tabla/columna
 *   3. lineage     — DAG de dependencias del DWH (desde dbt)
 *   4. tenancy     — multi-tenant isolation via RLS
 *   5. tags        — tags semanticos canonicos por columna
 *
 * Cada capa exporta su puerto, sus adapters (Postgres, InMemory para tests)
 * y un getter singleton para uso casual.
 *
 * Ver: docs/adr/005-data-governance-architecture.md
 *      docs/design/data-governance-v1.md
 *      .claude/rules/governance.md
 */

// =============================================================================
// Re-export DIRECTO de tipos publicos (para uso desde API routes y UI).
// Asi se pueden importar como:
//   import { type AuditCategory, recordAuditEvent } from "@/lib/domains/governance";
// =============================================================================

export type {
  AuditCategory,
  AuditEvent,
  AuditEventInput,
  AuditLogger,
  AuditQuery,
  AuditSeverity,
  AuditSource,
} from "./audit";

export type {
  GlossaryCategory,
  GlossaryEntry,
  GlossaryEntryInput,
  GlossaryQuery,
  GlossaryReader,
  GlossaryWriter,
} from "./glossary";

export type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  LineageQuery,
  LineageReader,
  LineageRelation,
  LineageWriter,
} from "./lineage";

export type {
  RequestContext,
  Tenant,
  TenantInput,
  TenantMembership,
  TenantPlan,
  TenantRole,
  TenantService,
  TenantStatus,
} from "./tenancy";

export type {
  ColumnTag,
  ColumnTagDescription,
  ColumnTagEntry,
  ColumnTagInput,
  ColumnTagQuery,
  ColumnTagService,
} from "./tags";

// =============================================================================
// Re-export de helpers / getters mas usados
// =============================================================================

export {
  getAuditLogger,
  recordAuditEvent,
  setAuditLogger,
  PostgresAuditLogger,
  InMemoryAuditLogger,
} from "./audit";

export {
  CANONICAL_GLOSSARY_SEED,
  getGlossary,
  setGlossary,
  PostgresGlossary,
} from "./glossary";

export { getLineage, setLineage, PostgresLineage, parseManifest } from "./lineage";

export {
  getTenantService,
  setTenantService,
  withRequestContext,
  executeWithContext,
  PostgresTenantService,
} from "./tenancy";

export {
  COLUMN_TAG_VOCABULARY,
  getColumnTagService,
  setColumnTagService,
  PostgresColumnTagService,
} from "./tags";

// =============================================================================
// Namespaces opcionales (para imports estilo `governance.audit.X`)
// =============================================================================

export * as audit from "./audit";
export * as glossary from "./glossary";
export * as lineage from "./lineage";
export * as tenancy from "./tenancy";
export * as tags from "./tags";
