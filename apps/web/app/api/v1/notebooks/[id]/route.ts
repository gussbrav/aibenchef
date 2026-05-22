import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { deleteNotebook, getNotebook } from "@/lib/domains/notebooks";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    return getNotebook(userId, id);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    await deleteNotebook(userId, id);
    return { deleted: true };
  });
}
