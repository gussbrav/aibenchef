/**
 * Domain: hojas de calculo (estilo Zoho/Excel).
 *
 * Sparse storage: cells JSONB con shape `{ "A1": value, "B2": value }`.
 * Solo persistimos celdas con contenido (no toda la grilla).
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError, toIso } from "@/lib/domains/shared";

export type SheetCells = Record<string, string | number | boolean | null>;

export type Sheet = {
  id: string;
  userId: string;
  nombre: string;
  descripcion: string | null;
  cells: SheetCells;
  nRows: number;
  nCols: number;
  esPublico: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SheetResumen = Omit<Sheet, "cells"> & { nCells: number };

function mapRow(r: Record<string, unknown>): Sheet {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    nombre: String(r.nombre),
    descripcion: (r.descripcion as string | null) ?? null,
    cells: (r.cells as SheetCells) ?? {},
    nRows: Number(r.n_rows),
    nCols: Number(r.n_cols),
    esPublico: Boolean(r.es_publico),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listSheets(userId: string): Promise<SheetResumen[]> {
  // n_cells via subquery escalar — jsonb_object_keys es SETOF y no se puede
  // usar directo en SELECT sin generar cardinalidad multi-row.
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, n_rows, n_cols, es_publico,
             created_at, updated_at,
             COALESCE((SELECT COUNT(*)::int FROM jsonb_object_keys(s.cells)), 0) AS n_cells
      FROM app.sheets s
      WHERE user_id = ${userId} OR es_publico = TRUE
      ORDER BY updated_at DESC
    `,
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    nombre: String(r.nombre),
    descripcion: (r.descripcion as string | null) ?? null,
    nRows: Number(r.n_rows),
    nCols: Number(r.n_cols),
    esPublico: Boolean(r.es_publico),
    nCells: Number(r.n_cells ?? 0),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  }));
}

export async function getSheet(userId: string, id: string): Promise<Sheet> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, cells, n_rows, n_cols, es_publico,
             created_at, updated_at
      FROM app.sheets
      WHERE id = ${id} AND (user_id = ${userId} OR es_publico = TRUE)
      LIMIT 1
    `,
  );
  if (rows.length === 0) throw new NotFoundError("Sheet no encontrada", {});
  return mapRow(rows[0]!);
}

export async function createSheet(
  userId: string,
  data: { nombre: string; descripcion?: string | null; nRows?: number; nCols?: number },
): Promise<Sheet> {
  if (!data.nombre.trim()) throw new ValidationError("Nombre requerido", {});
  const nRows = Math.min(Math.max(data.nRows ?? 100, 10), 10000);
  const nCols = Math.min(Math.max(data.nCols ?? 26, 5), 100);
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.sheets (user_id, nombre, descripcion, n_rows, n_cols)
      VALUES (${userId}, ${data.nombre.trim()}, ${data.descripcion ?? null}, ${nRows}, ${nCols})
      RETURNING id, user_id, nombre, descripcion, cells, n_rows, n_cols, es_publico,
                created_at, updated_at
    `,
  );
  return mapRow(rows[0]!);
}

export async function updateSheetCells(
  userId: string,
  id: string,
  data: { cells?: SheetCells; nombre?: string; descripcion?: string | null },
): Promise<Sheet> {
  // Verificar pertenencia
  await getSheet(userId, id);
  const sets: ReturnType<typeof sql>[] = [];
  if (data.cells !== undefined) {
    sets.push(sql`cells = ${JSON.stringify(data.cells)}::jsonb`);
  }
  if (data.nombre !== undefined) {
    if (!data.nombre.trim()) throw new ValidationError("Nombre vacio", {});
    sets.push(sql`nombre = ${data.nombre.trim()}`);
  }
  if (data.descripcion !== undefined) {
    sets.push(sql`descripcion = ${data.descripcion}`);
  }
  if (sets.length === 0) return getSheet(userId, id);

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      UPDATE app.sheets SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, user_id, nombre, descripcion, cells, n_rows, n_cols, es_publico,
                created_at, updated_at
    `,
  );
  if (rows.length === 0) throw new NotFoundError("Sheet no encontrada", {});
  return mapRow(rows[0]!);
}

export async function deleteSheet(userId: string, id: string): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`DELETE FROM app.sheets WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
  );
  if (rows.length === 0) throw new NotFoundError("Sheet no encontrada", {});
}
