/**
 * CRUD de app.saved_queries.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError, toIso } from "@/lib/domains/shared";

import type { SavedQuery } from "./types";

function mapRow(r: Record<string, unknown>): SavedQuery {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    nombre: String(r.nombre),
    descripcion: (r.descripcion as string | null) ?? null,
    sqlText: String(r.sql_text),
    parametros: (r.parametros as Record<string, unknown>) ?? {},
    esPublico: Boolean(r.es_publico),
    tags: (r.tags as string[]) ?? [],
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listSavedQueries(userId: string): Promise<SavedQuery[]> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, sql_text, parametros, es_publico,
             tags, created_at, updated_at
      FROM app.saved_queries
      WHERE user_id = ${userId} OR es_publico = TRUE
      ORDER BY updated_at DESC
    `,
  );
  return rows.map(mapRow);
}

export async function getSavedQuery(userId: string, id: string): Promise<SavedQuery> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, sql_text, parametros, es_publico,
             tags, created_at, updated_at
      FROM app.saved_queries
      WHERE id = ${id} AND (user_id = ${userId} OR es_publico = TRUE)
      LIMIT 1
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Query no encontrada: ${id}`, { id });
  }
  return mapRow(rows[0]!);
}

export async function createSavedQuery(
  userId: string,
  data: {
    nombre: string;
    descripcion?: string | null;
    sqlText: string;
    parametros?: Record<string, unknown>;
    esPublico?: boolean;
    tags?: string[];
  },
): Promise<SavedQuery> {
  if (!data.nombre.trim()) throw new ValidationError("Nombre requerido", {});
  if (!data.sqlText.trim()) throw new ValidationError("SQL requerido", {});

  const tagsArr = data.tags ?? [];
  const rows =
    tagsArr.length > 0
      ? await db.execute<Record<string, unknown>>(
          sql`
            INSERT INTO app.saved_queries
              (user_id, nombre, descripcion, sql_text, parametros, es_publico, tags)
            VALUES
              (${userId}, ${data.nombre.trim()}, ${data.descripcion ?? null}, ${data.sqlText},
               ${JSON.stringify(data.parametros ?? {})}::jsonb,
               ${data.esPublico ?? false},
               ${tagsArr}::text[])
            RETURNING id, user_id, nombre, descripcion, sql_text, parametros, es_publico,
                      tags, created_at, updated_at
          `,
        )
      : await db.execute<Record<string, unknown>>(
          sql`
            INSERT INTO app.saved_queries
              (user_id, nombre, descripcion, sql_text, parametros, es_publico)
            VALUES
              (${userId}, ${data.nombre.trim()}, ${data.descripcion ?? null}, ${data.sqlText},
               ${JSON.stringify(data.parametros ?? {})}::jsonb,
               ${data.esPublico ?? false})
            RETURNING id, user_id, nombre, descripcion, sql_text, parametros, es_publico,
                      tags, created_at, updated_at
          `,
        );
  return mapRow(rows[0]!);
}

export async function updateSavedQuery(
  userId: string,
  id: string,
  data: {
    nombre?: string;
    descripcion?: string | null;
    sqlText?: string;
    parametros?: Record<string, unknown>;
    esPublico?: boolean;
    tags?: string[];
  },
): Promise<SavedQuery> {
  await getSavedQuery(userId, id);

  const sets: ReturnType<typeof sql>[] = [];
  if (data.nombre !== undefined) {
    if (!data.nombre.trim()) throw new ValidationError("Nombre vacio", {});
    sets.push(sql`nombre = ${data.nombre.trim()}`);
  }
  if (data.descripcion !== undefined) sets.push(sql`descripcion = ${data.descripcion}`);
  if (data.sqlText !== undefined) sets.push(sql`sql_text = ${data.sqlText}`);
  if (data.parametros !== undefined) {
    sets.push(sql`parametros = ${JSON.stringify(data.parametros)}::jsonb`);
  }
  if (data.esPublico !== undefined) sets.push(sql`es_publico = ${data.esPublico}`);
  if (data.tags !== undefined) sets.push(sql`tags = ${data.tags}`);

  if (sets.length === 0) return getSavedQuery(userId, id);

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      UPDATE app.saved_queries
      SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, user_id, nombre, descripcion, sql_text, parametros, es_publico,
                tags, created_at, updated_at
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Query no encontrada o no es tuya: ${id}`, { id });
  }
  return mapRow(rows[0]!);
}

export async function deleteSavedQuery(userId: string, id: string): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      DELETE FROM app.saved_queries
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Query no encontrada: ${id}`, { id });
  }
}
