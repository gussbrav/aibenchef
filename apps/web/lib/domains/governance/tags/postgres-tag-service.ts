/**
 * Adapter Postgres del puerto ColumnTagService.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { toIso } from "@/lib/domains/shared";

import type {
  ColumnTag,
  ColumnTagEntry,
  ColumnTagInput,
  ColumnTagQuery,
  ColumnTagService,
} from "./types";

const MAX_LIMIT = 500;

export class PostgresColumnTagService implements ColumnTagService {
  async add(input: ColumnTagInput, setBy: string): Promise<ColumnTagEntry> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO gov.column_tags (schema_name, table_name, column_name, tag, note, set_by)
      VALUES (${input.schemaName}, ${input.tableName}, ${input.columnName},
              ${input.tag}::text, ${input.note ?? null}, ${setBy})
      ON CONFLICT (schema_name, table_name, column_name, tag) DO UPDATE SET
        note = EXCLUDED.note,
        set_by = EXCLUDED.set_by,
        set_at = now()
      RETURNING id::text AS id, schema_name, table_name, column_name, tag, note, set_by, set_at
    `);
    const r = rows[0];
    if (!r) throw new Error("add tag devolvio 0 filas");
    return mapRow(r);
  }

  async remove(id: string): Promise<void> {
    await db.execute(sql`DELETE FROM gov.column_tags WHERE id = ${id}::bigint`);
  }

  async list(filter: ColumnTagQuery): Promise<ColumnTagEntry[]> {
    const limit = Math.min(filter.limit ?? 200, MAX_LIMIT);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, schema_name, table_name, column_name, tag, note, set_by, set_at
      FROM gov.column_tags
      WHERE 1=1
        ${filter.schemaName ? sql`AND schema_name = ${filter.schemaName}` : sql``}
        ${filter.tableName ? sql`AND table_name = ${filter.tableName}` : sql``}
        ${filter.columnName ? sql`AND column_name = ${filter.columnName}` : sql``}
        ${
          filter.tags && filter.tags.length > 0
            ? sql`AND tag = ANY(${filter.tags}::text[])`
            : sql``
        }
      ORDER BY schema_name, table_name, column_name, tag
      LIMIT ${limit}
    `);
    return rows.map(mapRow);
  }

  async listForColumn(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<ColumnTagEntry[]> {
    return this.list({ schemaName, tableName, columnName, limit: 50 });
  }
}

function mapRow(r: Record<string, unknown>): ColumnTagEntry {
  return {
    id: String(r.id),
    schemaName: String(r.schema_name),
    tableName: String(r.table_name),
    columnName: String(r.column_name),
    tag: r.tag as ColumnTag,
    note: (r.note as string | null) ?? null,
    setBy: (r.set_by as string | null) ?? null,
    setAt: toIso(r.set_at),
  };
}
