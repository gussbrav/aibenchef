import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { executeQuerySandbox } from "@/lib/domains/sql-workbench";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sqlText: z.string().min(1).max(50_000),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    // Audit metadata: IP via x-forwarded-for (EasyPanel via Traefik) o
    // x-real-ip; user agent del header HTTP.
    const ip =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      null;
    const userAgent = hdrs.get("user-agent");

    const result = await executeQuerySandbox(parsed.data.sqlText, {
      userId: session.user.id,
      ip,
      userAgent,
    });

    // Audit event en gov.audit_log (dual-write con app.sql_audit_log).
    // Fire-and-forget — no propaga errores, la query ya se ejecuto.
    const ctx = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctx,
      category: "data_access",
      action: "sql_execute",
      severity: "info",
      resource: "sql:workbench",
      metadata: {
        sqlLength: parsed.data.sqlText.length,
        rowsReturned: result.totalFilas,
        durationMs: result.duracionMs,
        truncado: result.truncado,
      },
    });

    return result;
  });
}
