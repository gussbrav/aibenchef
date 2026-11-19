/**
 * Diagnostico rapido del subdominio governance.
 * Verifica que las tablas que inyecta el enrichment de insights existan y
 * esten accesibles. Devuelve un reporte estructurado para debug.
 *
 * GET /api/v1/admin/governance-health
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { db } from "@/lib/infrastructure/db";

export const dynamic = "force-dynamic";

type TableCheck = {
  schema: string;
  table: string;
  exists: boolean;
  rowCount: number | null;
  error: string | null;
};

async function checkTable(schema: string, table: string): Promise<TableCheck> {
  try {
    // 1. Verificar que la tabla exista en information_schema
    const existsRows = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = ${schema} AND table_name = ${table}
      ) AS exists
    `);
    const exists = existsRows[0]?.exists === true;
    if (!exists) {
      return { schema, table, exists: false, rowCount: null, error: null };
    }

    // 2. Count rows (sin lock pesado)
    const countRows = await db.execute<{ count: string }>(sql.raw(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."${table}"`,
    ));
    return {
      schema,
      table,
      exists: true,
      rowCount: Number(countRows[0]?.count ?? 0),
      error: null,
    };
  } catch (err) {
    return {
      schema,
      table,
      exists: false,
      rowCount: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getAppliedMigrations(): Promise<string[]> {
  try {
    const rows = await db.execute<{ version: string }>(sql`
      SELECT version FROM public.schema_migrations
       WHERE version >= 'V215'
       ORDER BY version
    `);
    return rows.map((r) => r.version);
  } catch {
    return [];
  }
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [entityProfiles, dailyUsage, macroContext, refreshLog, appliedMigrations] =
    await Promise.all([
      checkTable("gov", "entity_profiles"),
      checkTable("gov", "entity_research_daily_usage"),
      checkTable("gov", "macro_context"),
      checkTable("gov", "macro_context_refresh_log"),
      getAppliedMigrations(),
    ]);

  const v220Applied = appliedMigrations.includes("V220");
  const v221Applied = appliedMigrations.includes("V221");
  const allTablesExist =
    entityProfiles.exists &&
    dailyUsage.exists &&
    macroContext.exists &&
    refreshLog.exists;

  return NextResponse.json({
    ok: allTablesExist,
    appliedMigrations: {
      recent: appliedMigrations,
      v220: v220Applied,
      v221: v221Applied,
    },
    tables: {
      entityProfiles,
      dailyUsage,
      macroContext,
      refreshLog,
    },
    hint: allTablesExist
      ? "Todo OK. El contexto de governance esta disponible."
      : "Faltan tablas. Las migrations V220/V221 no se aplicaron correctamente. Revisar logs del contenedor en EasyPanel (buscar '[migrator]' y '[BOOT] MIGRATOR FAILED') para ver el error exacto. Workaround: aplicar las SQLs manualmente en la DB.",
  });
}
