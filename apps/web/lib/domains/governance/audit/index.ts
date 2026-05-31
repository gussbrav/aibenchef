/**
 * Facade publico del subdominio governance/audit.
 *
 * Exporta el puerto, los adapters, y una instancia singleton para uso
 * casual desde routes (con resolution lazy del adapter).
 *
 * Patron DI sencillo: por default usa PostgresAuditLogger. Tests
 * sobre-escriben con setAuditLogger(new InMemoryAuditLogger()).
 */

export type {
  AuditCategory,
  AuditEvent,
  AuditEventInput,
  AuditLogger,
  AuditQuery,
  AuditSeverity,
  AuditSource,
} from "./types";

import { PostgresAuditLogger } from "./postgres-audit-logger";
import type { AuditLogger } from "./types";

export { PostgresAuditLogger } from "./postgres-audit-logger";
export { InMemoryAuditLogger } from "./in-memory-audit-logger";

let _instance: AuditLogger | null = null;

/**
 * Devuelve la instancia activa. Lazy init para evitar cargar el adapter
 * Postgres en tests que no lo usan.
 */
export function getAuditLogger(): AuditLogger {
  if (_instance === null) _instance = new PostgresAuditLogger();
  return _instance;
}

/**
 * Override para tests. Llamar con `null` para reset al default.
 */
export function setAuditLogger(impl: AuditLogger | null): void {
  _instance = impl;
}

/**
 * Atajo conveniente para fire-and-forget logging desde routes.
 * Equivale a `getAuditLogger().log(event)`.
 */
export async function recordAuditEvent(
  event: Parameters<AuditLogger["log"]>[0],
): Promise<void> {
  return getAuditLogger().log(event);
}
