/**
 * Domain: gestion de usuarios + perfil propio.
 *
 * Two endpoints families:
 *  - getMe / updateMe: cualquier usuario autenticado puede editar su perfil
 *  - listUsers / updateUser / deleteUser: solo admin
 *
 * Better Auth password change se hace via authClient en el frontend
 * (auth.api.changePassword) — no replicamos eso aqui.
 */

import { cache } from "react";
import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import {
  ForbiddenError,
  NotFoundError,
  toIso,
  ValidationError,
} from "@/lib/domains/shared";
import type { UserPlan } from "@/lib/plans";

export type UserRole = "admin" | "usuario";
export type UserStatus = "active" | "suspended" | "invited";

export type User = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  invitedBy: string | null;
  /**
   * Cliente que el usuario ve por defecto al entrar al informe. NULL =
   * fallback global. Se puede cambiar desde Settings > Mi perfil.
   */
  defaultClienteSlug: string | null;
  /** Plan comercial (V167 + V168). Ver lib/plans.ts. */
  plan: UserPlan;
  /** Verificacion academica automatica via email .edu.pe (V168). */
  academicVerifiedAt: string | null;
  /** Ciclo de vida de suscripcion (V170). */
  lastLoginAt: string | null;
  planStartedAt: string | null;
  planExpiresAt: string | null;
  planChangedAt: string | null;
  planChangedBy: string | null;
  planNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRow(r: Record<string, unknown>): User {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    emailVerified: Boolean(r.email_verified),
    image: (r.image as string | null) ?? null,
    role: (r.role as UserRole) ?? "usuario",
    status: (r.status as UserStatus) ?? "active",
    invitedBy: (r.invited_by as string | null) ?? null,
    defaultClienteSlug: (r.default_cliente_slug as string | null) ?? null,
    plan: ((r.plan as string) ?? "free") as UserPlan,
    academicVerifiedAt: r.academic_verified_at
      ? toIso(r.academic_verified_at)
      : null,
    lastLoginAt: r.last_login_at ? toIso(r.last_login_at) : null,
    planStartedAt: r.plan_started_at ? toIso(r.plan_started_at) : null,
    planExpiresAt: r.plan_expires_at ? toIso(r.plan_expires_at) : null,
    planChangedAt: r.plan_changed_at ? toIso(r.plan_changed_at) : null,
    planChangedBy: (r.plan_changed_by as string | null) ?? null,
    planNotes: (r.plan_notes as string | null) ?? null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

const USER_SELECT_COLS = sql`
  id, email, name, email_verified, image, role, status,
  invited_by, default_cliente_slug, plan, academic_verified_at,
  last_login_at, plan_started_at, plan_expires_at,
  plan_changed_at, plan_changed_by, plan_notes,
  created_at, updated_at
`;

export async function getUser(userId: string): Promise<User> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT ${USER_SELECT_COLS}
      FROM auth.users
      WHERE id = ${userId}
      LIMIT 1
    `,
  );
  if (rows.length === 0) throw new NotFoundError("Usuario no encontrado", {});
  return mapRow(rows[0]!);
}

// React.cache dedupe: el layout y varias pages (informe, PE, DuPont,
// eeff, tableros, analisis, publicaciones) llaman isAdmin en el mismo
// request. Sin cache: N roundtrips DB (100-500ms cada uno). Con cache:
// 1 solo roundtrip por request. Scope de dedupe = request (correcto).
export const isAdmin = cache(async (userId: string): Promise<boolean> => {
  const rows = await db.execute<{ role: string }>(
    sql`SELECT role FROM auth.users WHERE id = ${userId} LIMIT 1`,
  );
  return rows[0]?.role === "admin";
});

export async function requireAdmin(userId: string): Promise<void> {
  if (!(await isAdmin(userId))) {
    throw new ForbiddenError("Solo administradores pueden realizar esta accion", {});
  }
}

// ============================================================================
// Perfil propio
// ============================================================================

export async function updateMyProfile(
  userId: string,
  data: {
    name?: string;
    image?: string | null;
    defaultClienteSlug?: string | null;
  },
): Promise<User> {
  const sets: ReturnType<typeof sql>[] = [];
  if (data.name !== undefined) {
    const n = data.name.trim();
    if (!n) throw new ValidationError("Nombre vacio", {});
    if (n.length > 120) throw new ValidationError("Nombre muy largo", {});
    sets.push(sql`name = ${n}`);
  }
  if (data.image !== undefined) {
    sets.push(sql`image = ${data.image}`);
  }
  if (data.defaultClienteSlug !== undefined) {
    const slug = data.defaultClienteSlug;
    if (slug !== null) {
      // Validar contra config.cliente activos — evita guardar slugs invalidos
      // que despues rompan el default en el SSR.
      const exists = await db.execute<{ slug: string }>(
        sql`SELECT slug FROM config.cliente WHERE slug = ${slug} AND activo LIMIT 1`,
      );
      if (exists.length === 0) {
        throw new ValidationError(
          `Cliente '${slug}' no existe o esta inactivo`,
          { slug },
        );
      }
    }
    sets.push(sql`default_cliente_slug = ${slug}`);
  }
  if (sets.length === 0) return getUser(userId);

  await db.execute(
    sql`UPDATE auth.users SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${userId}`,
  );
  try {
    await db.execute(
      sql`INSERT INTO auth.users_audit (user_id, accion, detalle, actor_id)
          VALUES (${userId}, 'update_profile', 'self', ${userId})`,
    );
  } catch {
    /* swallow */
  }
  return getUser(userId);
}

// ============================================================================
// Admin
// ============================================================================

export async function listUsers(): Promise<User[]> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT ${USER_SELECT_COLS}
      FROM auth.users
      ORDER BY
        CASE role WHEN 'admin' THEN 0 ELSE 1 END,
        created_at DESC
    `,
  );
  return rows.map(mapRow);
}

// ============================================================================
// Panel de suscripciones (V170)
// ============================================================================

export type ListUsersFilters = {
  /** Substring en email o name (ILIKE). */
  search?: string;
  plan?: UserPlan | "all";
  role?: UserRole | "all";
  status?: UserStatus | "all";
  /** Solo users que se loguearon en los ultimos N dias. */
  activeInDays?: number;
  /** Suscripciones que expiran en los proximos N dias. */
  expiringInDays?: number;
};

export type ListUsersSort =
  | "createdAtDesc"
  | "createdAtAsc"
  | "lastLoginDesc"
  | "lastLoginAsc"
  | "planExpiresAsc"
  | "emailAsc";

export type ListUsersPagedResult = {
  rows: User[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listUsersPaged(opts: {
  filters?: ListUsersFilters;
  sort?: ListUsersSort;
  page?: number;
  pageSize?: number;
}): Promise<ListUsersPagedResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, opts.pageSize ?? 25));
  const filters = opts.filters ?? {};
  const sort = opts.sort ?? "createdAtDesc";

  const conds: ReturnType<typeof sql>[] = [];
  if (filters.search) {
    const q = `%${filters.search.trim()}%`;
    conds.push(sql`(email ILIKE ${q} OR name ILIKE ${q})`);
  }
  if (filters.plan && filters.plan !== "all") {
    conds.push(sql`plan = ${filters.plan}`);
  }
  if (filters.role && filters.role !== "all") {
    conds.push(sql`role = ${filters.role}`);
  }
  if (filters.status && filters.status !== "all") {
    conds.push(sql`status = ${filters.status}`);
  }
  if (typeof filters.activeInDays === "number" && filters.activeInDays > 0) {
    conds.push(
      sql`last_login_at >= now() - (${filters.activeInDays} || ' days')::interval`,
    );
  }
  if (typeof filters.expiringInDays === "number" && filters.expiringInDays > 0) {
    conds.push(
      sql`plan_expires_at IS NOT NULL AND plan_expires_at <= now() + (${filters.expiringInDays} || ' days')::interval`,
    );
  }

  const where =
    conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const orderBy = (() => {
    switch (sort) {
      case "createdAtAsc":
        return sql`created_at ASC`;
      case "lastLoginDesc":
        return sql`last_login_at DESC NULLS LAST`;
      case "lastLoginAsc":
        return sql`last_login_at ASC NULLS LAST`;
      case "planExpiresAsc":
        return sql`plan_expires_at ASC NULLS LAST`;
      case "emailAsc":
        return sql`email ASC`;
      case "createdAtDesc":
      default:
        return sql`created_at DESC`;
    }
  })();

  const totalRows = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM auth.users ${where}`,
  );
  const total = Number(totalRows[0]?.n ?? 0);

  const offset = (page - 1) * pageSize;
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT ${USER_SELECT_COLS}
      FROM auth.users
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  );

  return { rows: rows.map(mapRow), total, page, pageSize };
}

export type UserStats = {
  total: number;
  byPlan: Record<UserPlan, number>;
  byRole: Record<UserRole, number>;
  byStatus: Record<UserStatus, number>;
  activeLast7d: number;
  activeLast30d: number;
  neverLoggedIn: number;
  expiringNext7d: number;
  expiringNext30d: number;
  /** MRR estimado en USD a partir de PLAN_META precios y suscripciones activas. */
  mrrUsd: number;
};

const PLAN_MRR_USD: Record<UserPlan, number> = {
  free: 0,
  academic: 9,
  pro: 149,
  business: 399,
};

export async function getUserStats(): Promise<UserStats> {
  // Un solo roundtrip con COUNT(*) FILTER (WHERE ...) — mucho mas barato
  // que N queries separadas.
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT
        COUNT(*)::int                                             AS total,
        COUNT(*) FILTER (WHERE plan = 'free')::int                AS n_free,
        COUNT(*) FILTER (WHERE plan = 'academic')::int            AS n_academic,
        COUNT(*) FILTER (WHERE plan = 'pro')::int                 AS n_pro,
        COUNT(*) FILTER (WHERE plan = 'business')::int            AS n_business,
        COUNT(*) FILTER (WHERE role = 'admin')::int               AS n_admin,
        COUNT(*) FILTER (WHERE role = 'usuario')::int             AS n_usuario,
        COUNT(*) FILTER (WHERE status = 'active')::int            AS n_active,
        COUNT(*) FILTER (WHERE status = 'suspended')::int         AS n_suspended,
        COUNT(*) FILTER (WHERE status = 'invited')::int           AS n_invited,
        COUNT(*) FILTER (WHERE last_login_at >= now() - interval '7 days')::int  AS active_7d,
        COUNT(*) FILTER (WHERE last_login_at >= now() - interval '30 days')::int AS active_30d,
        COUNT(*) FILTER (WHERE last_login_at IS NULL)::int        AS never_login,
        COUNT(*) FILTER (
          WHERE plan_expires_at IS NOT NULL
            AND plan_expires_at > now()
            AND plan_expires_at <= now() + interval '7 days'
        )::int AS exp_7d,
        COUNT(*) FILTER (
          WHERE plan_expires_at IS NOT NULL
            AND plan_expires_at > now()
            AND plan_expires_at <= now() + interval '30 days'
        )::int AS exp_30d
      FROM auth.users
    `,
  );
  const r = rows[0]!;
  const byPlan: Record<UserPlan, number> = {
    free: Number(r.n_free ?? 0),
    academic: Number(r.n_academic ?? 0),
    pro: Number(r.n_pro ?? 0),
    business: Number(r.n_business ?? 0),
  };
  const mrrUsd =
    byPlan.academic * PLAN_MRR_USD.academic +
    byPlan.pro * PLAN_MRR_USD.pro +
    byPlan.business * PLAN_MRR_USD.business;

  return {
    total: Number(r.total ?? 0),
    byPlan,
    byRole: {
      admin: Number(r.n_admin ?? 0),
      usuario: Number(r.n_usuario ?? 0),
    },
    byStatus: {
      active: Number(r.n_active ?? 0),
      suspended: Number(r.n_suspended ?? 0),
      invited: Number(r.n_invited ?? 0),
    },
    activeLast7d: Number(r.active_7d ?? 0),
    activeLast30d: Number(r.active_30d ?? 0),
    neverLoggedIn: Number(r.never_login ?? 0),
    expiringNext7d: Number(r.exp_7d ?? 0),
    expiringNext30d: Number(r.exp_30d ?? 0),
    mrrUsd,
  };
}

/**
 * Cambio de plan admin-driven. En fase manual pre-Culqi todos los upgrades
 * pasan por aca. Registra plan_changed_by + plan_changed_at + audit trail.
 *
 * Reglas:
 *   - No puedes cambiarte tu propio plan (usa otra cuenta admin).
 *   - Si plan == 'academic' y el user NO tiene email .edu.pe, se permite
 *     pero se anota en plan_notes (admin override consciente).
 *   - expiresAt null en free = correcto (free no expira). En pagos = "perpetuo".
 */
export async function updateUserPlan(
  actorId: string,
  targetId: string,
  plan: UserPlan,
  opts?: {
    expiresAt?: Date | null;
    notes?: string | null;
  },
): Promise<User> {
  await requireAdmin(actorId);
  if (actorId === targetId) {
    throw new ValidationError("No puedes cambiar tu propio plan", {});
  }
  const target = await getUser(targetId);
  const sets: ReturnType<typeof sql>[] = [
    sql`plan = ${plan}`,
    sql`plan_changed_at = now()`,
    sql`plan_changed_by = ${actorId}`,
  ];
  // plan_started_at se setea si es transicion desde free o si nunca se seteo.
  if (target.plan === "free" || target.planStartedAt === null) {
    sets.push(sql`plan_started_at = now()`);
  }
  if (opts?.expiresAt !== undefined) {
    sets.push(sql`plan_expires_at = ${opts.expiresAt}`);
  }
  if (opts?.notes !== undefined) {
    sets.push(sql`plan_notes = ${opts.notes}`);
  }
  await db.execute(
    sql`UPDATE auth.users SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${targetId}`,
  );
  try {
    await db.execute(
      sql`INSERT INTO auth.users_audit (user_id, accion, detalle, actor_id)
          VALUES (${targetId}, 'change_plan',
                  ${`from=${target.plan} to=${plan}`}, ${actorId})`,
    );
  } catch {
    /* swallow */
  }
  return getUser(targetId);
}

export async function updateUserRole(
  actorId: string,
  targetId: string,
  role: UserRole,
): Promise<User> {
  await requireAdmin(actorId);
  if (actorId === targetId) {
    throw new ValidationError("No puedes cambiar tu propio rol", {});
  }
  // Si demotamos el ultimo admin, prevenirlo
  if (role !== "admin") {
    const countRows = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM auth.users WHERE role = 'admin' AND id <> ${targetId}`,
    );
    if (Number(countRows[0]?.n ?? 0) === 0) {
      throw new ValidationError(
        "No puedes demotar al ultimo administrador del sistema",
        {},
      );
    }
  }
  await db.execute(
    sql`UPDATE auth.users SET role = ${role}, updated_at = now() WHERE id = ${targetId}`,
  );
  try {
    await db.execute(
      sql`INSERT INTO auth.users_audit (user_id, accion, detalle, actor_id)
          VALUES (${targetId}, ${role === "admin" ? "promote_admin" : "demote_admin"},
                  ${`role=${role}`}, ${actorId})`,
    );
  } catch {
    /* swallow */
  }
  return getUser(targetId);
}

export async function updateUserStatus(
  actorId: string,
  targetId: string,
  status: UserStatus,
): Promise<User> {
  await requireAdmin(actorId);
  if (actorId === targetId) {
    throw new ValidationError("No puedes cambiar tu propio status", {});
  }
  await db.execute(
    sql`UPDATE auth.users SET status = ${status}, updated_at = now() WHERE id = ${targetId}`,
  );
  try {
    await db.execute(
      sql`INSERT INTO auth.users_audit (user_id, accion, detalle, actor_id)
          VALUES (${targetId}, ${status === "suspended" ? "suspend" : "unsuspend"},
                  ${`status=${status}`}, ${actorId})`,
    );
  } catch {
    /* swallow */
  }
  return getUser(targetId);
}

/**
 * Admin renombra a otro usuario. Email NO se cambia desde aca (cambiar email
 * dispara re-verificacion y puede deslogear todas las sesiones — se hace por
 * flujo aparte si se necesita).
 */
export async function adminUpdateUserName(
  actorId: string,
  targetId: string,
  name: string,
): Promise<User> {
  await requireAdmin(actorId);
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Nombre vacio", {});
  if (trimmed.length > 120) throw new ValidationError("Nombre muy largo", {});
  await db.execute(
    sql`UPDATE auth.users SET name = ${trimmed}, updated_at = now() WHERE id = ${targetId}`,
  );
  try {
    await db.execute(
      sql`INSERT INTO auth.users_audit (user_id, accion, detalle, actor_id)
          VALUES (${targetId}, 'admin_rename', ${`name=${trimmed}`}, ${actorId})`,
    );
  } catch {
    /* swallow */
  }
  return getUser(targetId);
}

export async function deleteUser(actorId: string, targetId: string): Promise<void> {
  await requireAdmin(actorId);
  if (actorId === targetId) {
    throw new ValidationError("No puedes borrar tu propia cuenta desde aqui", {});
  }
  // No borrar al ultimo admin
  const target = await getUser(targetId);
  if (target.role === "admin") {
    const countRows = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM auth.users WHERE role = 'admin' AND id <> ${targetId}`,
    );
    if (Number(countRows[0]?.n ?? 0) === 0) {
      throw new ValidationError("No puedes borrar al ultimo administrador", {});
    }
  }
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${targetId}`);
}
