/**
 * PATCH /api/v1/admin/users/[id]/rename — admin cambia el nombre del usuario.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { adminUpdateUserName } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const updated = await adminUpdateUserName(session.user.id, id, parsed.data.name);

    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "user_rename",
      severity: "info",
      resource: `user:${id}`,
      metadata: { newName: parsed.data.name },
    });

    return updated;
  });
}
