/**
 * Healthcheck profundo: corre los queries reales de cada modulo para
 * identificar cual esta roto. Solo admin.
 *
 * Util cuando un endpoint devuelve 500 generico y quieres saber CUAL
 * subsistema esta fallando (DB, schema, query especifico).
 */

import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/infrastructure/db";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";
import { requireAdmin } from "@/lib/domains/users";

export const dynamic = "force-dynamic";

type Check = {
  name: string;
  status: "ok" | "error";
  detail?: string;
  durationMs: number;
  error?: string;
  errorCode?: string;
};

async function check(name: string, fn: () => Promise<unknown>): Promise<Check> {
  const start = Date.now();
  try {
    const result = await fn();
    let detail = "";
    if (Array.isArray(result)) detail = `${result.length} filas`;
    else if (result && typeof result === "object") detail = "OK";
    return { name, status: "ok", detail, durationMs: Date.now() - start };
  } catch (e) {
    const err = e as Error & { code?: string };
    return {
      name,
      status: "error",
      error: err.message,
      errorCode: err.code,
      durationMs: Date.now() - start,
    };
  }
}

export async function GET() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);
    const userId = session.user.id;

    const checks: Check[] = [];

    checks.push(
      await check("db_ping", () => db.execute(sql`SELECT 1 AS ok`)),
    );

    checks.push(
      await check("schema_app_exists", () =>
        db.execute(sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'`),
      ),
    );

    checks.push(
      await check("auth_users_count", () =>
        db.execute(sql`SELECT COUNT(*)::int AS n FROM auth.users`),
      ),
    );

    checks.push(
      await check("auth_users_has_role_column", () =>
        db.execute(
          sql`SELECT role, status FROM auth.users WHERE id = ${userId} LIMIT 1`,
        ),
      ),
    );

    checks.push(
      await check("app_notebooks_select", () =>
        db.execute(
          sql`SELECT id, titulo, tags FROM app.notebooks WHERE user_id = ${userId} LIMIT 5`,
        ),
      ),
    );

    checks.push(
      await check("app_tableros_select", () =>
        db.execute(
          sql`SELECT id, nombre, tags FROM app.tableros WHERE user_id = ${userId} LIMIT 5`,
        ),
      ),
    );

    checks.push(
      await check("app_sheets_select", () =>
        db.execute(
          sql`SELECT id, nombre, n_rows FROM app.sheets WHERE user_id = ${userId} LIMIT 5`,
        ),
      ),
    );

    checks.push(
      await check("app_ai_providers_select", () =>
        db.execute(sql`SELECT provider, enabled FROM app.ai_providers`),
      ),
    );

    checks.push(
      await check("app_invitations_select", () =>
        db.execute(
          sql`SELECT COUNT(*)::int AS n FROM app.invitations WHERE invited_by = ${userId}`,
        ),
      ),
    );

    checks.push(
      await check("marts_mv_eeff_ratios_count", () =>
        db.execute(sql`SELECT COUNT(*)::int AS n FROM marts.mv_eeff_ratios`),
      ),
    );

    checks.push(
      await check("dim_entidad_distinct", () =>
        db.execute(
          sql`SELECT COUNT(DISTINCT nomb_correg)::int AS n FROM dw.dim_entidad WHERE activa`,
        ),
      ),
    );

    checks.push(
      await check("migrations_count", () =>
        db.execute(
          sql`SELECT COUNT(*)::int AS n, MAX(version) AS last FROM public.schema_migrations`,
        ),
      ),
    );

    const totalErrors = checks.filter((c) => c.status === "error").length;
    return {
      overall: totalErrors === 0 ? "ok" : "error",
      errorCount: totalErrors,
      gitSha: process.env.GIT_SHA?.slice(0, 7) ?? null,
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      checks,
    };
  });
}
