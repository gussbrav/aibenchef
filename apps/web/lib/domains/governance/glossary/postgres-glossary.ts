/**
 * Adapter Postgres del puerto Glossary (Reader + Writer).
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { toIso } from "@/lib/domains/shared";

import type {
  GlossaryCategory,
  GlossaryEntry,
  GlossaryEntryInput,
  GlossaryQuery,
  GlossaryReader,
  GlossaryWriter,
} from "./types";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

export class PostgresGlossary implements GlossaryReader, GlossaryWriter {
  async getEntry(
    schemaName: string,
    tableName: string,
    columnName?: string | null,
  ): Promise<GlossaryEntry | null> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, schema_name, table_name, column_name,
             display_name, description, owner_email, category, applies_to,
             formula, example_usage, source, created_at, updated_at, updated_by
      FROM gov.business_glossary
      WHERE schema_name = ${schemaName}
        AND table_name = ${tableName}
        AND column_name IS NOT DISTINCT FROM ${columnName ?? null}
      LIMIT 1
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async list(filter: GlossaryQuery): Promise<GlossaryEntry[]> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(filter.offset ?? 0, 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, schema_name, table_name, column_name,
             display_name, description, owner_email, category, applies_to,
             formula, example_usage, source, created_at, updated_at, updated_by
      FROM gov.business_glossary
      WHERE 1=1
        ${filter.schemaName ? sql`AND schema_name = ${filter.schemaName}` : sql``}
        ${filter.tableName ? sql`AND table_name = ${filter.tableName}` : sql``}
        ${filter.columnName ? sql`AND column_name = ${filter.columnName}` : sql``}
        ${
          filter.category && filter.category.length > 0
            ? sql`AND category = ANY(${filter.category}::text[])`
            : sql``
        }
        ${
          filter.search
            ? sql`AND to_tsvector('spanish', display_name || ' ' || description)
                  @@ plainto_tsquery('spanish', ${filter.search})`
            : sql``
        }
      ORDER BY schema_name, table_name, column_name NULLS FIRST
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    return rows.map(mapRow);
  }

  async count(filter: Omit<GlossaryQuery, "limit" | "offset">): Promise<number> {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM gov.business_glossary
      WHERE 1=1
        ${filter.schemaName ? sql`AND schema_name = ${filter.schemaName}` : sql``}
        ${filter.tableName ? sql`AND table_name = ${filter.tableName}` : sql``}
        ${filter.columnName ? sql`AND column_name = ${filter.columnName}` : sql``}
        ${
          filter.category && filter.category.length > 0
            ? sql`AND category = ANY(${filter.category}::text[])`
            : sql``
        }
        ${
          filter.search
            ? sql`AND to_tsvector('spanish', display_name || ' ' || description)
                  @@ plainto_tsquery('spanish', ${filter.search})`
            : sql``
        }
    `);
    return Number(rows[0]?.n ?? 0);
  }

  async upsert(entry: GlossaryEntryInput, updatedBy: string): Promise<GlossaryEntry> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO gov.business_glossary (
        schema_name, table_name, column_name,
        display_name, description, owner_email,
        category, applies_to, formula, example_usage, source,
        updated_by
      )
      VALUES (
        ${entry.schemaName}, ${entry.tableName}, ${entry.columnName ?? null},
        ${entry.displayName}, ${entry.description}, ${entry.ownerEmail ?? null},
        ${entry.category ?? "general"}::text,
        ${entry.appliesTo ?? null}::text[],
        ${entry.formula ?? null}, ${entry.exampleUsage ?? null}, ${entry.source ?? null},
        ${updatedBy}
      )
      ON CONFLICT (schema_name, table_name, column_name) DO UPDATE SET
        display_name  = EXCLUDED.display_name,
        description   = EXCLUDED.description,
        owner_email   = EXCLUDED.owner_email,
        category      = EXCLUDED.category,
        applies_to    = EXCLUDED.applies_to,
        formula       = EXCLUDED.formula,
        example_usage = EXCLUDED.example_usage,
        source        = EXCLUDED.source,
        updated_at    = now(),
        updated_by    = EXCLUDED.updated_by
      RETURNING id::text AS id, schema_name, table_name, column_name,
                display_name, description, owner_email, category, applies_to,
                formula, example_usage, source, created_at, updated_at, updated_by
    `);
    const r = rows[0];
    if (!r) throw new Error("upsert glossary devolvio 0 filas");
    return mapRow(r);
  }

  async remove(id: string): Promise<void> {
    await db.execute(sql`DELETE FROM gov.business_glossary WHERE id = ${id}::bigint`);
  }
}

function mapRow(r: Record<string, unknown>): GlossaryEntry {
  return {
    id: String(r.id),
    schemaName: String(r.schema_name),
    tableName: String(r.table_name),
    columnName: (r.column_name as string | null) ?? null,
    displayName: String(r.display_name),
    description: String(r.description),
    ownerEmail: (r.owner_email as string | null) ?? null,
    category: r.category as GlossaryCategory,
    appliesTo: (r.applies_to as string[] | null) ?? [],
    formula: (r.formula as string | null) ?? null,
    exampleUsage: (r.example_usage as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}
