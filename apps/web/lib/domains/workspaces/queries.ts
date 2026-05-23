/**
 * CRUD de workspaces de Analisis Dinamico (app.workspaces_analisis).
 *
 * Todas las operaciones requieren userId — la autorizacion se hace en el
 * route handler via Better Auth session.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError, toIso } from "@/lib/domains/shared";

import type { WorkspaceAnalisis, WorkspaceAnalisisConfig } from "./types";

function mapRow(r: Record<string, unknown>): WorkspaceAnalisis {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    nombre: String(r.nombre),
    descripcion: (r.descripcion as string | null) ?? null,
    config: r.config as WorkspaceAnalisisConfig,
    esDefault: Boolean(r.es_default),
    esPublico: Boolean(r.es_publico),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listWorkspaces(userId: string): Promise<WorkspaceAnalisis[]> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, config, es_default, es_publico,
             created_at, updated_at
      FROM app.workspaces_analisis
      WHERE user_id = ${userId}
      ORDER BY es_default DESC, updated_at DESC
    `,
  );
  return rows.map(mapRow);
}

export async function getWorkspace(
  userId: string,
  id: string,
): Promise<WorkspaceAnalisis> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, config, es_default, es_publico,
             created_at, updated_at
      FROM app.workspaces_analisis
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Workspace no encontrado: ${id}`, { id });
  }
  return mapRow(rows[0]!);
}

export async function createWorkspace(
  userId: string,
  data: {
    nombre: string;
    descripcion?: string | null;
    config: WorkspaceAnalisisConfig;
    esDefault?: boolean;
  },
): Promise<WorkspaceAnalisis> {
  if (!data.nombre.trim()) {
    throw new ValidationError("Nombre requerido", {});
  }

  // Si se marca como default, desmarcar el anterior
  if (data.esDefault) {
    await db.execute(
      sql`UPDATE app.workspaces_analisis SET es_default = FALSE WHERE user_id = ${userId} AND es_default = TRUE`,
    );
  }

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.workspaces_analisis (user_id, nombre, descripcion, config, es_default)
      VALUES (${userId}, ${data.nombre.trim()}, ${data.descripcion ?? null}, ${JSON.stringify(data.config)}::jsonb, ${data.esDefault ?? false})
      RETURNING id, user_id, nombre, descripcion, config, es_default, es_publico, created_at, updated_at
    `,
  );
  return mapRow(rows[0]!);
}

export async function updateWorkspace(
  userId: string,
  id: string,
  data: {
    nombre?: string;
    descripcion?: string | null;
    config?: WorkspaceAnalisisConfig;
    esDefault?: boolean;
  },
): Promise<WorkspaceAnalisis> {
  // Verificar pertenencia
  await getWorkspace(userId, id);

  if (data.esDefault === true) {
    await db.execute(
      sql`UPDATE app.workspaces_analisis SET es_default = FALSE WHERE user_id = ${userId} AND es_default = TRUE AND id <> ${id}`,
    );
  }

  // Build dinamico de SET
  const sets: ReturnType<typeof sql>[] = [];
  if (data.nombre !== undefined) {
    if (!data.nombre.trim()) throw new ValidationError("Nombre vacio", {});
    sets.push(sql`nombre = ${data.nombre.trim()}`);
  }
  if (data.descripcion !== undefined) {
    sets.push(sql`descripcion = ${data.descripcion}`);
  }
  if (data.config !== undefined) {
    sets.push(sql`config = ${JSON.stringify(data.config)}::jsonb`);
  }
  if (data.esDefault !== undefined) {
    sets.push(sql`es_default = ${data.esDefault}`);
  }

  if (sets.length === 0) {
    return getWorkspace(userId, id);
  }

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      UPDATE app.workspaces_analisis
      SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, user_id, nombre, descripcion, config, es_default, es_publico, created_at, updated_at
    `,
  );
  return mapRow(rows[0]!);
}

export async function deleteWorkspace(userId: string, id: string): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      DELETE FROM app.workspaces_analisis
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Workspace no encontrado: ${id}`, { id });
  }
}
