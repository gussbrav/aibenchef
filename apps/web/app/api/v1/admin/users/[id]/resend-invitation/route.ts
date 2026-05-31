/**
 * POST /api/v1/admin/users/[id]/resend-invitation
 * Si existe una invitacion pendiente para el email de este usuario, re-envia
 * el email. Si no, error.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import {
  findPendingInvitationByEmail,
  resendInvitationEmail,
} from "@/lib/domains/invitations";
import { getUser } from "@/lib/domains/users";
import {
  handleRoute,
  NotFoundError,
  UnauthorizedError,
} from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    const user = await getUser(id);
    const invitation = await findPendingInvitationByEmail(user.email);
    if (!invitation) {
      throw new NotFoundError(
        `No hay invitacion pendiente para ${user.email}. El usuario ya completo el signup o nunca recibio una invitacion.`,
        {},
      );
    }
    const result = await resendInvitationEmail(session.user.id, invitation.id);

    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "invitation_resent",
      severity: "info",
      resource: `invitation:${invitation.id}`,
      metadata: { targetEmail: user.email },
    });

    return result;
  });
}
