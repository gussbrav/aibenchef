import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import {
  deleteUser,
  type UserRole,
  type UserStatus,
  updateUserRole,
  updateUserStatus,
} from "@/lib/domains/users";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const patchBody = z.object({
  role: z.enum(["admin", "usuario"]).optional(),
  status: z.enum(["active", "suspended", "invited"]).optional(),
});

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session;
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await requireSession();
    const actorId = session.user.id;
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    let updated;
    let action: string | null = null;
    if (parsed.data.role) {
      updated = await updateUserRole(actorId, id, parsed.data.role as UserRole);
      action = "user_role_change";
    }
    if (parsed.data.status) {
      updated = await updateUserStatus(actorId, id, parsed.data.status as UserStatus);
      action = "user_status_change";
    }
    if (!updated) {
      throw new ValidationError("Nada que actualizar", {});
    }

    if (action) {
      const ctxAudit = extractAuditContext(hdrs, actorId, session.user.email);
      await recordAuditEvent({
        ...ctxAudit,
        category: "admin",
        action,
        severity: "warn", // cambios de rol/status son sensibles
        resource: `user:${id}`,
        metadata: { role: parsed.data.role, status: parsed.data.status },
      });
    }

    return updated;
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await requireSession();
    const actorId = session.user.id;
    const { id } = await ctx.params;
    await deleteUser(actorId, id);

    const ctxAudit = extractAuditContext(hdrs, actorId, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "user_delete",
      severity: "critical",
      resource: `user:${id}`,
      metadata: {},
    });

    return { deleted: true };
  });
}
