import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError } from "@/lib/domains/shared";

import type { Tablero, TableroResumen, TableroWidget, WidgetConfig, WidgetTipo } from "./types";

function mapWidgetRow(r: Record<string, unknown>): TableroWidget {
  return {
    id: String(r.id),
    tableroId: String(r.tablero_id),
    tipo: r.tipo as WidgetTipo,
    titulo: (r.titulo as string | null) ?? null,
    config: (r.config as WidgetConfig) ?? {},
    posX: Number(r.pos_x),
    posY: Number(r.pos_y),
    posW: Number(r.pos_w),
    posH: Number(r.pos_h),
    orden: Number(r.orden),
  };
}

function mapTableroRow(r: Record<string, unknown>): Omit<Tablero, "widgets"> {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    nombre: String(r.nombre),
    descripcion: (r.descripcion as string | null) ?? null,
    esPublico: Boolean(r.es_publico),
    tags: (r.tags as string[]) ?? [],
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

export async function listTableros(userId: string): Promise<TableroResumen[]> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT t.id, t.user_id, t.nombre, t.descripcion, t.es_publico, t.tags,
             t.created_at, t.updated_at,
             (SELECT COUNT(*) FROM app.tablero_widgets w WHERE w.tablero_id = t.id) AS widgets_count
      FROM app.tableros t
      WHERE t.user_id = ${userId} OR t.es_publico = TRUE
      ORDER BY t.updated_at DESC
    `,
  );
  return rows.map((r) => ({
    ...mapTableroRow(r),
    widgetsCount: Number(r.widgets_count),
  }));
}

export async function getTablero(userId: string, id: string): Promise<Tablero> {
  const trows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, user_id, nombre, descripcion, es_publico, tags, created_at, updated_at
      FROM app.tableros
      WHERE id = ${id} AND (user_id = ${userId} OR es_publico = TRUE)
      LIMIT 1
    `,
  );
  if (trows.length === 0) {
    throw new NotFoundError(`Tablero no encontrado: ${id}`, { id });
  }
  const wrows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, tablero_id, tipo, titulo, config, pos_x, pos_y, pos_w, pos_h, orden
      FROM app.tablero_widgets
      WHERE tablero_id = ${id}
      ORDER BY orden, created_at
    `,
  );
  return {
    ...mapTableroRow(trows[0]!),
    widgets: wrows.map(mapWidgetRow),
  };
}

export async function createTablero(
  userId: string,
  data: { nombre: string; descripcion?: string | null; tags?: string[]; esPublico?: boolean },
): Promise<Tablero> {
  if (!data.nombre.trim()) throw new ValidationError("Nombre requerido", {});
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.tableros (user_id, nombre, descripcion, tags, es_publico)
      VALUES (${userId}, ${data.nombre.trim()}, ${data.descripcion ?? null},
              ${data.tags ?? []}, ${data.esPublico ?? false})
      RETURNING id, user_id, nombre, descripcion, es_publico, tags, created_at, updated_at
    `,
  );
  return { ...mapTableroRow(rows[0]!), widgets: [] };
}

export async function updateTablero(
  userId: string,
  id: string,
  data: { nombre?: string; descripcion?: string | null; tags?: string[]; esPublico?: boolean },
): Promise<Tablero> {
  await getTablero(userId, id);
  const sets: ReturnType<typeof sql>[] = [];
  if (data.nombre !== undefined) {
    if (!data.nombre.trim()) throw new ValidationError("Nombre vacio", {});
    sets.push(sql`nombre = ${data.nombre.trim()}`);
  }
  if (data.descripcion !== undefined) sets.push(sql`descripcion = ${data.descripcion}`);
  if (data.tags !== undefined) sets.push(sql`tags = ${data.tags}`);
  if (data.esPublico !== undefined) sets.push(sql`es_publico = ${data.esPublico}`);
  if (sets.length > 0) {
    await db.execute(
      sql`
        UPDATE app.tableros SET ${sql.join(sets, sql`, `)}
        WHERE id = ${id} AND user_id = ${userId}
      `,
    );
  }
  return getTablero(userId, id);
}

export async function deleteTablero(userId: string, id: string): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`DELETE FROM app.tableros WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Tablero no encontrado: ${id}`, { id });
  }
}

// ============================================================================
// Widgets
// ============================================================================

export async function createWidget(
  userId: string,
  tableroId: string,
  data: {
    tipo: WidgetTipo;
    titulo?: string | null;
    config?: WidgetConfig;
    posX?: number;
    posY?: number;
    posW?: number;
    posH?: number;
  },
): Promise<TableroWidget> {
  // Check ownership
  await getTablero(userId, tableroId);
  // Calcular orden = max + 1
  const ordRows = await db.execute<{ max_orden: number }>(
    sql`SELECT COALESCE(MAX(orden), -1) AS max_orden FROM app.tablero_widgets WHERE tablero_id = ${tableroId}`,
  );
  const nextOrden = Number((ordRows[0]?.max_orden ?? -1)) + 1;

  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.tablero_widgets
        (tablero_id, tipo, titulo, config, pos_x, pos_y, pos_w, pos_h, orden)
      VALUES
        (${tableroId}, ${data.tipo}, ${data.titulo ?? null},
         ${JSON.stringify(data.config ?? {})}::jsonb,
         ${data.posX ?? 0}, ${data.posY ?? 0},
         ${data.posW ?? 4}, ${data.posH ?? 4},
         ${nextOrden})
      RETURNING id, tablero_id, tipo, titulo, config, pos_x, pos_y, pos_w, pos_h, orden
    `,
  );
  return mapWidgetRow(rows[0]!);
}

export async function updateWidget(
  userId: string,
  tableroId: string,
  widgetId: string,
  data: Partial<{
    tipo: WidgetTipo;
    titulo: string | null;
    config: WidgetConfig;
    posX: number;
    posY: number;
    posW: number;
    posH: number;
  }>,
): Promise<TableroWidget> {
  await getTablero(userId, tableroId);
  const sets: ReturnType<typeof sql>[] = [];
  if (data.tipo !== undefined) sets.push(sql`tipo = ${data.tipo}`);
  if (data.titulo !== undefined) sets.push(sql`titulo = ${data.titulo}`);
  if (data.config !== undefined)
    sets.push(sql`config = ${JSON.stringify(data.config)}::jsonb`);
  if (data.posX !== undefined) sets.push(sql`pos_x = ${data.posX}`);
  if (data.posY !== undefined) sets.push(sql`pos_y = ${data.posY}`);
  if (data.posW !== undefined) sets.push(sql`pos_w = ${data.posW}`);
  if (data.posH !== undefined) sets.push(sql`pos_h = ${data.posH}`);
  if (sets.length === 0) {
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM app.tablero_widgets WHERE id = ${widgetId} AND tablero_id = ${tableroId} LIMIT 1`,
    );
    if (rows.length === 0) throw new NotFoundError("Widget no encontrado", {});
    return mapWidgetRow(rows[0]!);
  }
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      UPDATE app.tablero_widgets SET ${sql.join(sets, sql`, `)}
      WHERE id = ${widgetId} AND tablero_id = ${tableroId}
      RETURNING id, tablero_id, tipo, titulo, config, pos_x, pos_y, pos_w, pos_h, orden
    `,
  );
  if (rows.length === 0) throw new NotFoundError("Widget no encontrado", {});
  return mapWidgetRow(rows[0]!);
}

// Bulk update positions (drag/resize en el grid)
export async function updateWidgetsLayout(
  userId: string,
  tableroId: string,
  layout: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): Promise<void> {
  await getTablero(userId, tableroId);
  // En PG no hay UPDATE ... VALUES masivo trivial; iteramos secuencialmente.
  // Para volumes < 50 widgets es OK.
  for (const l of layout) {
    await db.execute(
      sql`
        UPDATE app.tablero_widgets
        SET pos_x = ${l.x}, pos_y = ${l.y}, pos_w = ${l.w}, pos_h = ${l.h}
        WHERE id = ${l.id} AND tablero_id = ${tableroId}
      `,
    );
  }
}

export async function deleteWidget(
  userId: string,
  tableroId: string,
  widgetId: string,
): Promise<void> {
  await getTablero(userId, tableroId);
  const rows = await db.execute<Record<string, unknown>>(
    sql`DELETE FROM app.tablero_widgets WHERE id = ${widgetId} AND tablero_id = ${tableroId} RETURNING id`,
  );
  if (rows.length === 0) throw new NotFoundError("Widget no encontrado", {});
}
