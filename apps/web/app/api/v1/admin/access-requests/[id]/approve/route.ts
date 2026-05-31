/**
 * POST /api/v1/admin/access-requests/[id]/approve
 * { role: "admin"|"usuario", notas?: string }
 *
 * Aprueba la solicitud, crea invitacion automaticamente y dispara email.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { approveAccessRequest } from "@/lib/domains/access-requests";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  role: z.enum(["admin", "usuario"]).default("usuario"),
  notas: z.string().max(500).nullable().optional(),
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
    const result = await approveAccessRequest(session.user.id, id, {
      role: parsed.data.role,
      notas: parsed.data.notas ?? null,
    });
    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "access_request_approved",
      severity: "info",
      resource: `access_request:${id}`,
      metadata: {
        email: result.accessRequest.email,
        role: parsed.data.role,
        invitationId: result.accessRequest.invitationId,
        emailSent: result.emailSent,
      },
    });
    return result;
  });
}
