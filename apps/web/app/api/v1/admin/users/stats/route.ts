import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { getUserStats, requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/users/stats
 *
 * Metricas agregadas para el panel /dashboard/admin/suscripciones:
 * total, breakdown por plan/role/status, actividad reciente, expiraciones
 * proximas, MRR estimado.
 *
 * Un solo roundtrip DB (COUNT(*) FILTER). Sin cache — el panel se refresca
 * inmediatamente despues de cada cambio de plan.
 */
export async function GET() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);
    return await getUserStats();
  });
}
