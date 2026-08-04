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

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import {
  ForbiddenError,
  NotFoundError,
  toIso,
  ValidationError,
} from "@/lib/domains/shared";

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
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function getUser(userId: string): Promise<User> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, email, name, email_verified, image, role, status,
             invited_by, default_cliente_slug, created_at, updated_at
      FROM auth.users
      WHERE id = ${userId}
      LIMIT 1
    `,
  );
  if (rows.length === 0) throw new NotFoundError("Usuario no encontrado", {});
  return mapRow(rows[0]!);
}

export async function isAdmin(userId: string): Promise<boolean> {
  const rows = await db.execute<{ role: string }>(
    sql`SELECT role FROM auth.users WHERE id = ${userId} LIMIT 1`,
  );
  return rows[0]?.role === "admin";
}

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
      SELECT id, email, name, email_verified, image, role, status,
             invited_by, default_cliente_slug, created_at, updated_at
      FROM auth.users
      ORDER BY
        CASE role WHEN 'admin' THEN 0 ELSE 1 END,
        created_at DESC
    `,
  );
  return rows.map(mapRow);
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
