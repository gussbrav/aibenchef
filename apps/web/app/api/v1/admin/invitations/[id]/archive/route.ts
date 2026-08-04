import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { archiveInvitation, unarchiveInvitation } from "@/lib/domains/invitations";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — archiva (soft-hide del listado default). Solo aceptadas/revocadas/expiradas.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    await archiveInvitation(session.user.id, id);
    return { archived: true };
  });
}

/**
 * DELETE — desarchiva (restaura al listado default).
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    await unarchiveInvitation(session.user.id, id);
    return { archived: false };
  });
}
