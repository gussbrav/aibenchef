/**
 * Aplica las migrations pendientes on-demand y devuelve el error exacto
 * si alguna falla. Sirve cuando el migrator del entrypoint del contenedor
 * falla en silencio (CMD tolerante) y necesitamos ver el error de Postgres
 * sin acceso a los logs.
 *
 * Solo admin. Cada migration corre en su propia tx — si falla, rollback,
 * pasa a la siguiente. Idempotente (skip las ya aplicadas).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/infrastructure/db";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";
import { requireAdmin } from "@/lib/domains/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "/app/migrations";

type MigResult = {
  version: string;
  status: "skipped" | "applied" | "failed";
  durationMs: number;
  errorMessage?: string;
  errorCode?: string;
  errorHint?: string;
  errorPosition?: string;
};

async function appliedVersions(): Promise<Set<string>> {
  const rows = await db.execute<{ version: string }>(
    sql`SELECT version FROM public.schema_migrations`,
  );
  return new Set(rows.map((r) => String(r.version)));
}

function listMigrations(): { version: string; path: string }[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^V\d+__.*\.sql$/.test(f))
    .sort();
  return files.map((f) => ({
    version: f.split("__")[0] ?? f,
    path: join(MIGRATIONS_DIR, f),
  }));
}

async function applyOne(version: string, path: string): Promise<MigResult> {
  const start = Date.now();
  try {
    const ddl = readFileSync(path, "utf-8");
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(ddl));
      await tx.execute(
        sql`INSERT INTO public.schema_migrations (version) VALUES (${version})`,
      );
    });
    return {
      version,
      status: "applied",
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const err = e as Error & {
      code?: string;
      hint?: string;
      position?: string;
      detail?: string;
    };
    return {
      version,
      status: "failed",
      durationMs: Date.now() - start,
      errorMessage: err.message,
      errorCode: err.code,
      errorHint: err.hint ?? err.detail,
      errorPosition: err.position,
    };
  }
}

export async function POST() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const applied = await appliedVersions();
    const migrations = listMigrations();
    const results: MigResult[] = [];

    for (const { version, path } of migrations) {
      if (applied.has(version)) {
        results.push({ version, status: "skipped", durationMs: 0 });
        continue;
      }
      const r = await applyOne(version, path);
      results.push(r);
      if (r.status === "failed") break;
    }

    return {
      migrationsDir: MIGRATIONS_DIR,
      totalOnDisk: migrations.length,
      alreadyApplied: applied.size,
      results,
    };
  });
}

export async function GET() {
  return POST();
}
