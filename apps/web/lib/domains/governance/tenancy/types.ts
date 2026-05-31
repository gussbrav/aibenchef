/**
 * Tipos publicos del subdominio governance/tenancy.
 *
 * Capa 4 — multi-tenant isolation via Postgres Row-Level Security (RLS).
 *
 * Modelo:
 * - Un User puede pertenecer a N Tenants (via tenant_membership).
 * - Cada request establece UN tenant_context (SET LOCAL app.tenant_id).
 * - Las policies RLS de tablas multi-tenant filtran por ese setting.
 */

export type TenantPlan = "free" | "pro" | "business" | "enterprise";

export type TenantStatus = "active" | "suspended" | "deleted";

export type TenantRole = "owner" | "admin" | "editor" | "viewer";

export type Tenant = {
  id: string; // UUID
  name: string;
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type TenantMembership = {
  tenantId: string;
  userId: string;
  role: TenantRole;
  invitedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

export type TenantInput = {
  name: string;
  slug: string;
  plan?: TenantPlan;
  metadata?: Record<string, unknown>;
};

/**
 * Contexto activo del request actual. Inyectado en cada query como
 * GUC `app.tenant_id` y `app.user_id`. Las policies RLS lo usan.
 */
export type RequestContext = {
  userId: string;
  tenantId: string | null;
  isAdmin: boolean;
};

/**
 * PORT de tenant management.
 */
export interface TenantService {
  /** Lista todos los tenants visibles segun RLS. */
  list(): Promise<Tenant[]>;

  /** Get un tenant por slug o id. */
  getBySlug(slug: string): Promise<Tenant | null>;
  getById(id: string): Promise<Tenant | null>;

  /** Crea un tenant nuevo. Solo admin. */
  create(input: TenantInput): Promise<Tenant>;

  /** Lista memberships del user actual. */
  listMembershipsOf(userId: string): Promise<Array<TenantMembership & { tenant: Tenant }>>;

  /** Agrega o updatea membership. */
  upsertMembership(
    tenantId: string,
    userId: string,
    role: TenantRole,
    invitedBy: string,
  ): Promise<TenantMembership>;

  /** Verifica si user es miembro del tenant. Util para gates. */
  isMember(tenantId: string, userId: string): Promise<boolean>;
}
