import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError } from "@/lib/domains/shared";

export type CellTipo = "markdown" | "sql" | "chart";

export type NotebookCell = {
  id: string;
  notebookId: string;
  tipo: CellTipo;
  contenido: string;
  config: Record<string, unknown>;
  fuenteCellId: string | null;
  orden: number;
};

export type Notebook = {
  id: string;
  userId: string;
  titulo: string;
  descripcion: string | null;
  esPublico: boolean;
  tags: string[];
  cells: NotebookCell[];
  createdAt: string;
  updatedAt: string;
};

function mapCell(r: Record<string, unknown>): NotebookCell {
  return {
    id: String(r.id),
    notebookId: String(r.notebook_id),
    tipo: r.tipo as CellTipo,
    contenido: String(r.contenido ?? ""),
    config: (r.config as Record<string, unknown>) ?? {},
    fuenteCellId: (r.fuente_cell_id as string | null) ?? null,
    orden: Number(r.orden),
  };
}

function mapNotebook(r: Record<string, unknown>): Omit<Notebook, "cells"> {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    titulo: String(r.titulo),
    descripcion: (r.descripcion as string | null) ?? null,
    esPublico: Boolean(r.es_publico),
    tags: (r.tags as string[]) ?? [],
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

export async function listNotebooks(userId: string) {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT n.id, n.user_id, n.titulo, n.descripcion, n.es_publico, n.tags,
             n.created_at, n.updated_at,
             (SELECT COUNT(*) FROM app.notebook_cells c WHERE c.notebook_id = n.id) AS n_cells
      FROM app.notebooks n
      WHERE n.user_id = ${userId} OR n.es_publico = TRUE
      ORDER BY n.updated_at DESC
    `,
  );
  return rows.map((r) => ({ ...mapNotebook(r), nCells: Number(r.n_cells) }));
}

export async function getNotebook(userId: string, id: string): Promise<Notebook> {
  const nrows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, titulo, descripcion, es_publico, tags, created_at, updated_at
      FROM app.notebooks
      WHERE id = ${id} AND (user_id = ${userId} OR es_publico = TRUE)
      LIMIT 1
    `,
  );
  if (nrows.length === 0) throw new NotFoundError("Notebook no encontrado", {});
  const crows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, notebook_id, tipo, contenido, config, fuente_cell_id, orden
      FROM app.notebook_cells
      WHERE notebook_id = ${id}
      ORDER BY orden, created_at
    `,
  );
  return { ...mapNotebook(nrows[0]!), cells: crows.map(mapCell) };
}

export async function createNotebook(
  userId: string,
  data: { titulo: string; descripcion?: string | null; tags?: string[] },
): Promise<Notebook> {
  if (!data.titulo.trim()) throw new ValidationError("Titulo requerido", {});
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.notebooks (user_id, titulo, descripcion, tags)
      VALUES (${userId}, ${data.titulo.trim()}, ${data.descripcion ?? null}, ${data.tags ?? []})
      RETURNING id, user_id, titulo, descripcion, es_publico, tags, created_at, updated_at
    `,
  );
  return { ...mapNotebook(rows[0]!), cells: [] };
}

export async function deleteNotebook(userId: string, id: string): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`DELETE FROM app.notebooks WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
  );
  if (rows.length === 0) throw new NotFoundError("Notebook no encontrado", {});
}

export async function createCell(
  userId: string,
  notebookId: string,
  data: {
    tipo: CellTipo;
    contenido?: string;
    config?: Record<string, unknown>;
    fuenteCellId?: string | null;
    orden?: number;
  },
): Promise<NotebookCell> {
  await getNotebook(userId, notebookId);
  const ordRows = await db.execute<{ max_orden: number }>(
    sql`SELECT COALESCE(MAX(orden), -1) AS max_orden FROM app.notebook_cells WHERE notebook_id = ${notebookId}`,
  );
  const nextOrden = data.orden ?? Number(ordRows[0]?.max_orden ?? -1) + 1;
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.notebook_cells
        (notebook_id, tipo, contenido, config, fuente_cell_id, orden)
      VALUES
        (${notebookId}, ${data.tipo}, ${data.contenido ?? ""},
         ${JSON.stringify(data.config ?? {})}::jsonb,
         ${data.fuenteCellId ?? null}, ${nextOrden})
      RETURNING id, notebook_id, tipo, contenido, config, fuente_cell_id, orden
    `,
  );
  return mapCell(rows[0]!);
}

export async function updateCell(
  userId: string,
  notebookId: string,
  cellId: string,
  data: Partial<{
    contenido: string;
    config: Record<string, unknown>;
    fuenteCellId: string | null;
    orden: number;
  }>,
): Promise<NotebookCell> {
  await getNotebook(userId, notebookId);
  const sets: ReturnType<typeof sql>[] = [];
  if (data.contenido !== undefined) sets.push(sql`contenido = ${data.contenido}`);
  if (data.config !== undefined) sets.push(sql`config = ${JSON.stringify(data.config)}::jsonb`);
  if (data.fuenteCellId !== undefined) sets.push(sql`fuente_cell_id = ${data.fuenteCellId}`);
  if (data.orden !== undefined) sets.push(sql`orden = ${data.orden}`);
  if (sets.length === 0) {
    const r = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM app.notebook_cells WHERE id = ${cellId} AND notebook_id = ${notebookId} LIMIT 1`,
    );
    if (r.length === 0) throw new NotFoundError("Cell no encontrada", {});
    return mapCell(r[0]!);
  }
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      UPDATE app.notebook_cells SET ${sql.join(sets, sql`, `)}
      WHERE id = ${cellId} AND notebook_id = ${notebookId}
      RETURNING id, notebook_id, tipo, contenido, config, fuente_cell_id, orden
    `,
  );
  if (rows.length === 0) throw new NotFoundError("Cell no encontrada", {});
  return mapCell(rows[0]!);
}

export async function deleteCell(userId: string, notebookId: string, cellId: string) {
  await getNotebook(userId, notebookId);
  await db.execute(
    sql`DELETE FROM app.notebook_cells WHERE id = ${cellId} AND notebook_id = ${notebookId}`,
  );
}
