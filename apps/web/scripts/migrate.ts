/**
 * Migrator — aplica las V*.sql en orden contra DATABASE_URL.
 *
 * Mantiene tabla `public.schema_migrations` con las versiones aplicadas.
 * Idempotente: cada V*.sql debe ser idempotente por convencion.
 *
 * Se compila a CommonJS en el Dockerfile y corre antes de Next.js start.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "/app/migrations";

const log = (msg: string): void => console.log(`[migrator] ${msg}`);

async function waitForDb(url: string, maxAttempts = 10): Promise<postgres.Sql> {
  // connect_timeout: 30s — si PG esta cargado (REFRESH MV pesados, ETL),
  // 5s era muy corto y el handshake TCP no alcanzaba a completar.
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 30 });
    try {
      await sql`SELECT 1`;
      log(`postgres ready (attempt ${attempt})`);
      return sql;
    } catch {
      await sql.end({ timeout: 1 }).catch(() => {});
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      log(`postgres not ready (attempt ${attempt}/${maxAttempts}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("postgres unreachable after retries");
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function appliedVersions(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`SELECT version FROM public.schema_migrations`;
  return new Set(rows.map((r) => r.version));
}

function listMigrations(dir: string): { version: string; path: string }[] {
  const files = readdirSync(dir)
    .filter((f) => /^V\d+__.*\.sql$/.test(f))
    .sort();
  return files.map((f) => ({
    version: f.split("__")[0] ?? f,
    path: join(dir, f),
  }));
}

async function applyMigration(
  sql: postgres.Sql,
  version: string,
  path: string,
): Promise<void> {
  const ddl = readFileSync(path, "utf-8");
  log(`applying ${version} (${path})`);
  await sql.begin(async (tx) => {
    await tx.unsafe(ddl);
    await tx`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
  });
  log(`OK ${version}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL no definida");
  }
  log(`migrations dir: ${MIGRATIONS_DIR}`);
  const sql = await waitForDb(url);
  try {
    await ensureMigrationsTable(sql);
    const applied = await appliedVersions(sql);
    const migrations = listMigrations(MIGRATIONS_DIR);
    log(`found ${migrations.length} migrations; ${applied.size} already applied`);
    for (const { version, path } of migrations) {
      if (applied.has(version)) {
        log(`skip ${version} (already applied)`);
        continue;
      }
      await applyMigration(sql, version, path);
    }
    log("done");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrator] FATAL", err);
  process.exit(1);
});
