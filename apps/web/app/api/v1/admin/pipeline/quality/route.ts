/**
 * GET /api/v1/admin/pipeline/quality
 *   ?periodo=YYYYMM
 *   ?checkType=balance_contable|outlier_zscore|suma_subcuentas
 *   ?status=ok|warning|critical
 *   ?unreviewed=true
 *   ?limit=100
 *
 * Devuelve {summary, rows}:
 *   - summary: counts por check_type para el periodo
 *   - rows:    detalle filtrable de admin.data_quality_checks
 *
 * Issue #24 — Pipeline Observability V2 Data Quality.
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import {
  getQualitySummary,
  listQualityChecks,
} from "@/lib/domains/pipeline";
import type {
  DataQualityCheckType,
  Severity,
} from "@/lib/domains/pipeline";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

const CHECK_TYPES: DataQualityCheckType[] = [
  "balance_contable",
  "outlier_zscore",
  "suma_subcuentas",
];
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
        throw new ValidationError("periodo debe ser YYYYMM valido", {});
      }
      periodo = n;
    }

    const checkTypeRaw = sp.get("checkType");
    const checkType =
      checkTypeRaw && (CHECK_TYPES as string[]).includes(checkTypeRaw)
        ? (checkTypeRaw as DataQualityCheckType)
        : undefined;

    const statusRaw = sp.get("status");
    const status =
      statusRaw && (SEVERITY_VALIDOS as string[]).includes(statusRaw)
        ? (statusRaw as Severity)
        : undefined;

    const unreviewed = sp.get("unreviewed") === "true";
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 100), 1), 500);

    const [summary, rows] = await Promise.all([
      getQualitySummary(periodo),
      listQualityChecks({ periodo, checkType, status, unreviewed, limit }),
    ]);

    return { summary, rows };
  });
}
