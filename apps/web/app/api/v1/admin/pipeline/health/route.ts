/**
 * GET /api/v1/admin/pipeline/health
 *
 * Snapshot del estado del pipeline:
 * - Ultima corrida exitosa de cada stage (scrape / import / refresh-mvs / detectar-cambios)
 * - Lag de la data: ultimo periodo ingestado + meses de retraso vs lo esperado
 *
 * Usado en la seccion 1 (Salud General) de /dashboard/admin/pipeline.
 */

import { requireAdminSession } from "@/lib/auth-helpers";
import { getPipelineHealth } from "@/lib/domains/pipeline";
import { handleRoute } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    await requireAdminSession();
    return await getPipelineHealth();
  });
}
