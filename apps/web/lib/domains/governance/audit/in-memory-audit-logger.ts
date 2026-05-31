/**
 * Adapter en memoria — para tests. NO usar en produccion.
 *
 * Cumple el mismo puerto AuditLogger asi los tests no necesitan Postgres.
 */

import type {
  AuditEvent,
  AuditEventInput,
  AuditLogger,
  AuditQuery,
} from "./types";

export class InMemoryAuditLogger implements AuditLogger {
  private nextId = 1;
  private events: AuditEvent[] = [];

  async log(event: AuditEventInput): Promise<void> {
    const stored: AuditEvent = {
      id: String(this.nextId++),
      occurredAt: new Date().toISOString(),
      category: event.category,
      action: event.action,
      severity: event.severity ?? "info",
      actorId: event.actorId ?? null,
      actorEmail: event.actorEmail ?? null,
      tenantId: event.tenantId ?? null,
      resource: event.resource ?? null,
      metadata: event.metadata ?? {},
      source: event.source ?? "api",
      traceId: event.traceId ?? null,
    };
    this.events.unshift(stored); // mas reciente primero
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    return this.filter(filter).slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100));
  }

  async count(filter: Omit<AuditQuery, "limit" | "offset">): Promise<number> {
    return this.filter(filter).length;
  }

  private filter(f: Omit<AuditQuery, "limit" | "offset">): AuditEvent[] {
    return this.events.filter((e) => {
      if (f.categories && !f.categories.includes(e.category)) return false;
      if (f.actorId && e.actorId !== f.actorId) return false;
      if (f.tenantId && e.tenantId !== f.tenantId) return false;
      if (f.severity && !f.severity.includes(e.severity)) return false;
      if (f.resourcePattern) {
        const pat = f.resourcePattern.replace(/%/g, ".*").replace(/_/g, ".");
        const re = new RegExp(`^${pat}$`);
        if (!e.resource || !re.test(e.resource)) return false;
      }
      if (f.since && e.occurredAt < f.since) return false;
      if (f.until && e.occurredAt > f.until) return false;
      return true;
    });
  }

  /** Helper de tests: limpia el store. */
  clear(): void {
    this.events = [];
    this.nextId = 1;
  }

  /** Helper de tests: snapshot del store. */
  all(): AuditEvent[] {
    return [...this.events];
  }
}
