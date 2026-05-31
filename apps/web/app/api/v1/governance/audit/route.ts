/**
 * GET /api/v1/governance/audit
 *
 * Lista paginada del audit_log unificado. Solo admins.
 *
 * Query params:
 *   - categories: csv de AuditCategory
 *   - severity:   csv de AuditSeverity
 *   - actorId:    str
 *   - tenantId:   uuid
 *   - resource:   LIKE pattern (ej "marts.%")
 *   - since:      ISO timestamp
 *   - until:      ISO timestamp
 *   - limit:      int (default 100, max 500)
 *   - offset:     int (default 0)
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  type AuditCategory,
  type AuditSeverity,
  getAuditLogger,
} from "@/lib/domains/governance/audit";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = new Set<AuditCategory>([
  "auth",
  "billing",
  "data_access",
  "genie",
  "ai_providers",
  "governance",
  "schema",
  "admin",
]);

const VALID_SEVERITIES = new Set<AuditSeverity>([
  "debug",
  "info",
  "warn",
  "error",
  "critical",
]);

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const url = new URL(req.url);
    const categoriesParam = url.searchParams.get("categories");
    const severityParam = url.searchParams.get("severity");

    const categories = categoriesParam
      ? (categoriesParam
          .split(",")
          .filter((c) => VALID_CATEGORIES.has(c as AuditCategory)) as AuditCategory[])
      : undefined;

    const severity = severityParam
      ? (severityParam
          .split(",")
          .filter((s) => VALID_SEVERITIES.has(s as AuditSeverity)) as AuditSeverity[])
      : undefined;

    const filter = {
      categories,
      severity,
      actorId: url.searchParams.get("actorId") ?? undefined,
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      resourcePattern: url.searchParams.get("resource") ?? undefined,
      since: url.searchParams.get("since") ?? undefined,
      until: url.searchParams.get("until") ?? undefined,
      limit: url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : undefined,
      offset: url.searchParams.get("offset")
        ? Number(url.searchParams.get("offset"))
        : undefined,
    };

    const logger = getAuditLogger();
    const [rows, total] = await Promise.all([
      logger.query(filter),
      logger.count(filter),
    ]);
    return { rows, total };
  });
}
