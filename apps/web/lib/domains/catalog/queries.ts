import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ValidationError } from "@/lib/domains/shared";

import type { CatalogColumna, CatalogTabla, CatalogTablaDetalle } from "./types";

const SCHEMAS_PERMITIDOS = ["marts", "dw", "raw"];

function ensureSchema(schema: string) {
  if (!SCHEMAS_PERMITIDOS.includes(schema)) {
    throw new ValidationError(`Schema no permitido en catalog: ${schema}`, {
      schema,
      permitidos: SCHEMAS_PERMITIDOS,
    });
  }
}

function ensureIdent(s: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(s)) {
    throw new ValidationError(`Identificador invalido: ${s}`, {});
  }
}

export async function listTablas(): Promise<CatalogTabla[]> {
  const rows = await db.execute<Record<string, unknown>>(
    sql.raw(`
      WITH tabs AS (
        SELECT
          n.nspname AS schema,
          c.relname AS tabla,
          CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized_view'
            WHEN 'p' THEN 'table'
          END AS tipo,
          obj_description(c.oid, 'pg_class') AS comentario,
          c.reltuples::bigint AS filas_aprox
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('marts','dw','raw')
          AND c.relkind IN ('r','v','m','p')
      )
      SELECT schema, tabla, tipo, comentario, filas_aprox
      FROM tabs
      ORDER BY schema, tabla
    `),
  );
  return rows.map((r) => ({
    schema: String(r.schema),
    tabla: String(r.tabla),
    tipo: r.tipo as CatalogTabla["tipo"],
    comentario: (r.comentario as string | null) ?? null,
    filas: r.filas_aprox === null ? null : Number(r.filas_aprox),
  }));
}

export async function getTablaDetalle(
  schema: string,
  tabla: string,
): Promise<CatalogTablaDetalle> {
  ensureSchema(schema);
  ensureIdent(tabla);

  // Metadata
  const tabRows = await db.execute<Record<string, unknown>>(
    sql.raw(`
      SELECT
        n.nspname AS schema,
        c.relname AS tabla,
        CASE c.relkind
          WHEN 'r' THEN 'table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          WHEN 'p' THEN 'table'
        END AS tipo,
        obj_description(c.oid, 'pg_class') AS comentario,
        c.reltuples::bigint AS filas_aprox
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${schema}' AND c.relname = '${tabla}'
      LIMIT 1
    `),
  );
  if (tabRows.length === 0) {
    throw new NotFoundError(`Tabla no encontrada: ${schema}.${tabla}`, {});
  }
  const tabRow = tabRows[0]!;

  // Columnas
  const colRows = await db.execute<Record<string, unknown>>(
    sql.raw(`
      SELECT
        a.attname AS nombre,
        format_type(a.atttypid, a.atttypmod) AS tipo,
        NOT a.attnotnull AS nullable,
        col_description(c.oid, a.attnum) AS comentario,
        a.attnum AS posicion
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${schema}' AND c.relname = '${tabla}'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `),
  );
  const columnas: CatalogColumna[] = colRows.map((r) => ({
    nombre: String(r.nombre),
    tipo: String(r.tipo),
    nullable: Boolean(r.nullable),
    comentario: (r.comentario as string | null) ?? null,
    posicion: Number(r.posicion),
  }));

  // Sample rows (10) — solo si es SELECT-able
  let sampleRows: Array<Record<string, unknown>> = [];
  try {
    sampleRows = (await db.execute<Record<string, unknown>>(
      sql.raw(`SELECT * FROM ${schema}.${tabla} LIMIT 10`),
    )) as Array<Record<string, unknown>>;
  } catch {
    sampleRows = [];
  }

  return {
    schema: String(tabRow.schema),
    tabla: String(tabRow.tabla),
    tipo: tabRow.tipo as CatalogTabla["tipo"],
    comentario: (tabRow.comentario as string | null) ?? null,
    filas: tabRow.filas_aprox === null ? null : Number(tabRow.filas_aprox),
    columnas,
    sampleRows,
  };
}
