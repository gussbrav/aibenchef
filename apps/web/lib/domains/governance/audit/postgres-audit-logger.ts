/**
 * Adapter Postgres del puerto AuditLogger.
 *
 * Implementa el contrato definido en types.ts contra el schema `gov` (V124).
 * Usa la funcion `gov.record_audit_event` que es SECURITY DEFINER y maneja
 * el RLS bypass de INSERT.
 *
 * Errores en log() se LOGUEAN pero no se propagan — el audit no debe
 * romper la operacion principal (write-once, fire-and-forget para el caller).
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { logger, toIso } from "@/lib/domains/shared";

import type {
  AuditEvent,
  AuditEventInput,
  AuditLogger,
  AuditQuery,
  AuditCategory,
  AuditSeverity,
  AuditSource,
} from "./types";

const log = logger.child("governance.audit.postgres");

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export class PostgresAuditLogger implements AuditLogger {
  async log(event: AuditEventInput): Promise<void> {
    try {
      await db.execute(sql`
        SELECT gov.record_audit_event(
          ${event.category}::text,
          ${event.action}::text,
          ${event.severity ?? "info"}::text,
          ${event.actorId ?? null}::text,
          ${event.actorEmail ?? null}::text,
          ${event.tenantId ?? null}::uuid,
          ${event.resource ?? null}::text,
          ${JSON.stringify(event.metadata ?? {})}::jsonb,
          ${event.payloadHash ?? null}::text,
          ${event.source ?? "api"}::text,
          ${event.ipAddress ?? null}::inet,
          ${event.traceId ?? null}::text
        )
      `);
    } catch (e) {
      // No propagar — el audit no debe romper la operacion principal.
      log.error("audit.log_failed", {
        error: e instanceof Error ? e.message : String(e),
        category: event.category,
        action: event.action,
      });
    }
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(filter.offset ?? 0, 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT al.id::text AS id,
             al.occurred_at,
             al.category,
             al.action,
             al.severity,
             al.actor_id,
             al.actor_email,
             al.tenant_id::text AS tenant_id,
             al.resource,
             al.metadata,
             al.source,
             al.trace_id,
             t.name AS tenant_name,
             t.slug AS tenant_slug
      FROM gov.audit_log al
      LEFT JOIN gov.tenants t ON t.id = al.tenant_id
      WHERE 1=1
        ${
          filter.categories && filter.categories.length > 0
            ? sql`AND al.category = ANY(${filter.categories}::text[])`
            : sql``
        }
        ${filter.actorId ? sql`AND al.actor_id = ${filter.actorId}` : sql``}
        ${filter.tenantId ? sql`AND al.tenant_id = ${filter.tenantId}::uuid` : sql``}
        ${
          filter.severity && filter.severity.length > 0
            ? sql`AND al.severity = ANY(${filter.severity}::text[])`
            : sql``
        }
        ${filter.resourcePattern ? sql`AND al.resource LIKE ${filter.resourcePattern}` : sql``}
        ${filter.since ? sql`AND al.occurred_at >= ${filter.since}::timestamptz` : sql``}
        ${filter.until ? sql`AND al.occurred_at <= ${filter.until}::timestamptz` : sql``}
      ORDER BY al.occurred_at DESC, al.id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    return rows.map(mapRow);
  }

  async count(filter: Omit<AuditQuery, "limit" | "offset">): Promise<number> {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM gov.audit_log al
      WHERE 1=1
        ${
          filter.categories && filter.categories.length > 0
            ? sql`AND al.category = ANY(${filter.categories}::text[])`
            : sql``
        }
        ${filter.actorId ? sql`AND al.actor_id = ${filter.actorId}` : sql``}
        ${filter.tenantId ? sql`AND al.tenant_id = ${filter.tenantId}::uuid` : sql``}
        ${
          filter.severity && filter.severity.length > 0
            ? sql`AND al.severity = ANY(${filter.severity}::text[])`
            : sql``
        }
        ${filter.resourcePattern ? sql`AND al.resource LIKE ${filter.resourcePattern}` : sql``}
        ${filter.since ? sql`AND al.occurred_at >= ${filter.since}::timestamptz` : sql``}
        ${filter.until ? sql`AND al.occurred_at <= ${filter.until}::timestamptz` : sql``}
    `);
    return Number(rows[0]?.n ?? 0);
  }
}

function mapRow(r: Record<string, unknown>): AuditEvent {
  return {
    id: String(r.id),
    occurredAt: toIso(r.occurred_at),
    category: r.category as AuditCategory,
    action: String(r.action),
    severity: r.severity as AuditSeverity,
    actorId: (r.actor_id as string | null) ?? null,
    actorEmail: (r.actor_email as string | null) ?? null,
    tenantId: (r.tenant_id as string | null) ?? null,
    resource: (r.resource as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    source: r.source as AuditSource,
    traceId: (r.trace_id as string | null) ?? null,
    tenantName: (r.tenant_name as string | null) ?? null,
    tenantSlug: (r.tenant_slug as string | null) ?? null,
  };
}
