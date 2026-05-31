/**
 * POST /api/v1/admin/access-requests/[id]/reject
 * { reason?: string }
 *
 * Marca la solicitud como rechazada. No envia email por default (puede ser
 * sensible). Si en el futuro queremos rechazo con email, agregar flag aqui.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { rejectAccessRequest } from "@/lib/domains/access-requests";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await rejectAccessRequest(session.user.id, id, parsed.data.reason ?? null);
    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "access_request_rejected",
      severity: "info",
      resource: `access_request:${id}`,
      metadata: { email: result.email, reason: parsed.data.reason ?? null },
    });
    return result;
  });
}
