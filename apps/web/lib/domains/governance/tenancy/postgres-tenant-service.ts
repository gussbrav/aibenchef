/**
 * Adapter Postgres del puerto TenantService.
 *
 * Las queries SELECT respetan RLS implicitamente — si la sesion no tiene
 * el GUC `app.user_id` seteado, devuelven vacio. Las queries WRITE
 * requieren `app.is_admin = 'true'`.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { ValidationError, toIso } from "@/lib/domains/shared";

import type {
  Tenant,
  TenantInput,
  TenantMembership,
  TenantPlan,
  TenantRole,
  TenantService,
  TenantStatus,
} from "./types";

export class PostgresTenantService implements TenantService {
  async list(): Promise<Tenant[]> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, name, slug, plan, status, created_at, updated_at, metadata
      FROM gov.tenants
      WHERE status != 'deleted'
      ORDER BY name
    `);
    return rows.map(mapTenant);
  }

  async getBySlug(slug: string): Promise<Tenant | null> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, name, slug, plan, status, created_at, updated_at, metadata
      FROM gov.tenants
      WHERE slug = ${slug}
      LIMIT 1
    `);
    return rows[0] ? mapTenant(rows[0]) : null;
  }

  async getById(id: string): Promise<Tenant | null> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, name, slug, plan, status, created_at, updated_at, metadata
      FROM gov.tenants
      WHERE id = ${id}::uuid
      LIMIT 1
    `);
    return rows[0] ? mapTenant(rows[0]) : null;
  }

  async create(input: TenantInput): Promise<Tenant> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.slug)) {
      throw new ValidationError("Slug invalido (solo a-z, 0-9, -)", { slug: input.slug });
    }
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO gov.tenants (name, slug, plan, metadata)
      VALUES (${input.name}, ${input.slug}, ${input.plan ?? "free"}::text,
              ${JSON.stringify(input.metadata ?? {})}::jsonb)
      RETURNING id::text AS id, name, slug, plan, status, created_at, updated_at, metadata
    `);
    const r = rows[0];
    if (!r) throw new Error("create tenant devolvio 0 filas");
    return mapTenant(r);
  }

  async listMembershipsOf(userId: string): Promise<Array<TenantMembership & { tenant: Tenant }>> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT m.tenant_id::text AS tenant_id, m.user_id, m.role, m.invited_by,
             m.accepted_at, m.created_at,
             t.name AS t_name, t.slug AS t_slug, t.plan AS t_plan,
             t.status AS t_status, t.created_at AS t_created_at,
             t.updated_at AS t_updated_at, t.metadata AS t_metadata
      FROM gov.tenant_membership m
      JOIN gov.tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${userId}
        AND t.status = 'active'
      ORDER BY t.name
    `);
    return rows.map((r) => ({
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      role: r.role as TenantRole,
      invitedBy: (r.invited_by as string | null) ?? null,
      acceptedAt: r.accepted_at ? toIso(r.accepted_at) : null,
      createdAt: toIso(r.created_at),
      tenant: {
        id: String(r.tenant_id),
        name: String(r.t_name),
        slug: String(r.t_slug),
        plan: r.t_plan as TenantPlan,
        status: r.t_status as TenantStatus,
        createdAt: toIso(r.t_created_at),
        updatedAt: toIso(r.t_updated_at),
        metadata: (r.t_metadata as Record<string, unknown>) ?? {},
      },
    }));
  }

  async upsertMembership(
    tenantId: string,
    userId: string,
    role: TenantRole,
    invitedBy: string,
  ): Promise<TenantMembership> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO gov.tenant_membership (tenant_id, user_id, role, invited_by)
      VALUES (${tenantId}::uuid, ${userId}, ${role}::text, ${invitedBy})
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        invited_by = COALESCE(gov.tenant_membership.invited_by, EXCLUDED.invited_by)
      RETURNING tenant_id::text AS tenant_id, user_id, role, invited_by, accepted_at, created_at
    `);
    const r = rows[0];
    if (!r) throw new Error("upsert membership devolvio 0 filas");
    return {
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      role: r.role as TenantRole,
      invitedBy: (r.invited_by as string | null) ?? null,
      acceptedAt: r.accepted_at ? toIso(r.accepted_at) : null,
      createdAt: toIso(r.created_at),
    };
  }

  async isMember(tenantId: string, userId: string): Promise<boolean> {
    const rows = await db.execute<{ exists_: boolean }>(sql`
      SELECT EXISTS(
        SELECT 1 FROM gov.tenant_membership
        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}
      ) AS exists_
    `);
    return Boolean(rows[0]?.exists_);
  }
}

function mapTenant(r: Record<string, unknown>): Tenant {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    plan: r.plan as TenantPlan,
    status: r.status as TenantStatus,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}
