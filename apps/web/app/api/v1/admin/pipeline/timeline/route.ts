/**
 * GET /api/v1/admin/pipeline/timeline?limit=20
 *
 * Ultimas N corridas del pipeline (raw.carga_log). Default 20, max 200.
 * Usado para la seccion 5 (Timeline) de /dashboard/admin/pipeline.
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import { getTimeline } from "@/lib/domains/pipeline";
import { handleRoute } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdminSession();
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 20), 1), 200);
    return await getTimeline(limit);
  });
}
