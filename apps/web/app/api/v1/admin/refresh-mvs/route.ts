/**
 * POST /api/v1/admin/refresh-mvs
 *
 * Refresca las materialized views del informe (mora, cobertura CAR).
 * Util cuando entra data nueva de SBS y quieres ver los cambios reflejados
 * sin esperar al cron post-ingest mensual. Tambien util para "destrabar"
 * accordions que dan timeout porque la MV esta vacia o stale.
 *
 * Solo admins. Llama marts.refresh_mvs_informe() (creada en V128).
 */

import { headers } from "next/headers";
import { revalidateTag } from "next/cache";

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

    // Invalidar caches del informe — el data en las MVs cambio, los tags
    // 'informe' y 'periodos' apuntan a getInformeDataCached() +
    // cachedListPeriodos() + cachedListEntidades() en page.tsx del informe.
    // Sin esto, el usuario veria data vieja hasta expirar el revalidate.
    revalidateTag("informe");
    revalidateTag("periodos");
    revalidateTag("entidades");

    return {
      results: rows.map((r) => ({
        mv: String(r.mv_name),
        refreshedAt: r.refreshed_at,
        success: Boolean(r.success),
        error: r.error,
      })),
      cachesInvalidated: ["informe", "periodos", "entidades"],
    };
  });
}
