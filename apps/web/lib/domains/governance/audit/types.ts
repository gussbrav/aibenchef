/**
 * Tipos publicos del subdominio governance/audit.
 *
 * Contrato hacia el resto del codigo. La implementacion (Postgres,
 * memoria, no-op) se intercambia via DI sin afectar a consumers.
 */

export type AuditSeverity = "debug" | "info" | "warn" | "error" | "critical";

export type AuditSource = "api" | "worker" | "migration" | "manual" | "test";

/**
 * Categorias canonicas. Vocabulario fijo para que las queries y filtros
 * de UI sean estables.
 *
 * - auth: login, logout, password reset, invitation accept
 * - billing: subscription created/cancelled, payment success/fail
 * - data_access: query ejecutada en /sql, descarga de CSV/Excel
 * - genie: prompt NL2SQL ejecutado
 * - ai_providers: cambios de api key, baseUrl, enable/disable
 * - governance: cambios en glossary, tags, lineage, tenant
 * - schema: migracion aplicada, refresh de marts
 * - admin: cambios de rol, suspender usuario
 *
 * Si agregas categoria nueva, documentar aca y en docs/design/data-governance-v1.md.
 */
export type AuditCategory =
  | "auth"
  | "billing"
  | "data_access"
  | "genie"
  | "ai_providers"
  | "governance"
  | "schema"
  | "admin";

export type AuditEventInput = {
  category: AuditCategory;
  action: string;
  severity?: AuditSeverity;
  actorId?: string | null;
  actorEmail?: string | null;
  tenantId?: string | null;
  resource?: string | null;
  metadata?: Record<string, unknown>;
  payloadHash?: string | null;
  source?: AuditSource;
  ipAddress?: string | null;
  traceId?: string | null;
};

export type AuditEvent = {
  id: string;
  occurredAt: string; // ISO 8601
  category: AuditCategory;
  action: string;
  severity: AuditSeverity;
  actorId: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  resource: string | null;
  metadata: Record<string, unknown>;
  source: AuditSource;
  traceId: string | null;
  tenantName?: string | null;
  tenantSlug?: string | null;
};

export type AuditQuery = {
  categories?: AuditCategory[];
  actorId?: string;
  tenantId?: string;
  severity?: AuditSeverity[];
  resourcePattern?: string; // SQL LIKE pattern
  since?: string; // ISO date
  until?: string;
  limit?: number; // default 100, max 500
  offset?: number;
};

/**
 * PORT (interface) del audit logger.
 *
 * Cualquier adapter (PostgresAuditLogger, InMemoryAuditLogger,
 * NoOpAuditLogger para tests) debe cumplirla. DIP en accion.
 */
export interface AuditLogger {
  /**
   * Registra un evento. Idempotente si payloadHash se provee (UNIQUE check
   * en backend). Nunca throwa salvo errores severos de infra — falla
   * silente con log.error para no romper la operacion del caller.
   */
  log(event: AuditEventInput): Promise<void>;

  /** Lectura paginada con filtros. */
  query(filter: AuditQuery): Promise<AuditEvent[]>;

  /** Conteo total para paginacion (con mismos filtros, sin limit/offset). */
  count(filter: Omit<AuditQuery, "limit" | "offset">): Promise<number>;
}
