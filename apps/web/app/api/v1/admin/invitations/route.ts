import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { createInvitation, listInvitations } from "@/lib/domains/invitations";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const createBody = z.object({
  email: z.string().email().max(200),
  role: z.enum(["admin", "usuario"]).default("usuario"),
  notas: z.string().max(500).nullable().optional(),
});

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session;
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    await requireAdmin(session.user.id);
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const rows = await listInvitations({ includeArchived });
    return { rows, count: rows.length };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await requireSession();
    const userId = session.user.id;
    const json = await req.json();
    const parsed = createBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const invitation = await createInvitation(userId, parsed.data);

    const ctxAudit = extractAuditContext(hdrs, userId, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "invitation_created",
      severity: "info",
      resource: `invitation:${parsed.data.email}`,
      metadata: { role: parsed.data.role },
    });

    return invitation;
  });
}
