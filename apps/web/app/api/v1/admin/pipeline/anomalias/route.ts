/**
 * GET /api/v1/admin/pipeline/anomalias
 *   ?periodo=YYYYMM
 *   ?unreviewed=true   (solo no revisadas)
 *   ?severity=warning|critical|info
 *   ?limit=100
 *
 * Lista anomalias estructurales detectadas por `aibenchef pipeline post-import-check`.
 * Ordenadas por severity (critical -> warning -> info) y detected_at desc.
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import { listAnomalias } from "@/lib/domains/pipeline";
import type { Severity } from "@/lib/domains/pipeline";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

const SEVERITY_VALIDOS: Severity[] = ["info", "warning", "critical"];

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdminSession();
    const sp = req.nextUrl.searchParams;

    let periodo: number | undefined;
    const periodoRaw = sp.get("periodo");
    if (periodoRaw) {
      const n = Number(periodoRaw);
      if (!Number.isFinite(n) || n < 200001) {
        throw new ValidationError("periodo invalido", {});
      }
      periodo = n;
    }

    const severityRaw = sp.get("severity");
    const severity =
      severityRaw && (SEVERITY_VALIDOS as string[]).includes(severityRaw)
        ? (severityRaw as Severity)
        : undefined;

    const unreviewed = sp.get("unreviewed") === "true";
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 100), 1), 500);

    return await listAnomalias({ periodo, severity, unreviewed, limit });
  });
}
