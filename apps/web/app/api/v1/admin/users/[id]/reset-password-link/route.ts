/**
 * POST /api/v1/admin/users/[id]/reset-password-link
 * Admin genera una URL de reset de contraseña para entregar al usuario.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { createResetTokenForUser } from "@/lib/domains/password-reset";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    const result = await createResetTokenForUser(session.user.id, id);

    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "password_reset_link_generated",
      severity: "warn", // admin genera link sensible para otro user
      resource: `user:${id}`,
      metadata: {},
    });

    return result;
  });
}
