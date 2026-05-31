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

export * as audit from "./audit";
export * as glossary from "./glossary";
export * as lineage from "./lineage";
export * as tenancy from "./tenancy";
export * as tags from "./tags";

// Re-export de helpers usados frecuentemente
export { recordAuditEvent, getAuditLogger } from "./audit";
export { getGlossary } from "./glossary";
export { getLineage } from "./lineage";
export { getTenantService, withRequestContext } from "./tenancy";
export { getColumnTagService } from "./tags";
