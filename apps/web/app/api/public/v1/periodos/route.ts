import type { NextRequest } from "next/server";

import { withApiPublic } from "@/lib/api-public/middleware";
import { listPeriodosDisponibles } from "@/lib/domains/informe/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/periodos[?ultimosN=60]
 *
 * Lista de periodos YYYYMM publicados con al menos EEFF disponible.
 * Ordenados DESC (mas reciente primero). Por defecto ultimos 240 (20 anios).
 *
 * Response: { data: [202606, 202605, 202604, ...] }
 */
export async function GET(req: NextRequest) {
  return withApiPublic(req, async () => {
    const url = new URL(req.url);
    const nStr = url.searchParams.get("ultimosN");
    const n = nStr ? Math.max(1, Math.min(240, Number.parseInt(nStr, 10))) : 240;
    return listPeriodosDisponibles({ ultimosN: n });
  });
}
