import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { acceptInvitation } from "@/lib/domains/invitations";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

// Llamado por el frontend de signup INMEDIATAMENTE despues de que Better Auth
// crea la cuenta. Verifica que el email del usuario autenticado matchea con
// la invitacion, asigna el rol invitado, y consume el token.
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Tenes que estar autenticado", {});
    const { token } = await ctx.params;
    const result = await acceptInvitation(token, session.user.id);

    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "auth",
      action: "invitation_accepted",
      severity: "info",
      resource: `invitation:${token.slice(0, 8)}...`,
      metadata: {},
    });

    return result;
  });
}
