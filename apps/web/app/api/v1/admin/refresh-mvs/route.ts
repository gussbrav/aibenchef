/**
 * POST /api/v1/admin/refresh-mvs
 *
 * Refresca las materialized views del informe (mora, cobertura CAR).
 * Util cuando entra data nueva de SBS y queres ver los cambios reflejados
 * sin esperar al cron post-ingest mensual. Tambien util para "destrabar"
 * accordions que dan timeout porque la MV esta vacia o stale.
 *
 * Solo admins. Llama marts.refresh_mvs_informe() (creada en V128).
 */

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/infrastructure/db";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);
    const rows = await db.execute<{
      mv_name: string;
      refreshed_at: string;
      success: boolean;
      error: string | null;
    }>(sql`SELECT mv_name, refreshed_at, success, error FROM marts.refresh_mvs_informe()`);
    return {
      results: rows.map((r) => ({
        mv: String(r.mv_name),
        refreshedAt: r.refreshed_at,
        success: Boolean(r.success),
        error: r.error,
      })),
    };
  });
}
