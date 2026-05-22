import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
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

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const actorId = await requireUserId();
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    let updated;
    if (parsed.data.role) {
      updated = await updateUserRole(actorId, id, parsed.data.role as UserRole);
    }
    if (parsed.data.status) {
      updated = await updateUserStatus(actorId, id, parsed.data.status as UserStatus);
    }
    if (!updated) {
      throw new ValidationError("Nada que actualizar", {});
    }
    return updated;
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const actorId = await requireUserId();
    const { id } = await ctx.params;
    await deleteUser(actorId, id);
    return { deleted: true };
  });
}
