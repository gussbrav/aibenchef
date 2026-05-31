/**
 * POST /api/v1/admin/users/[id]/reset-password-link
 * Admin genera una URL de reset de contraseña para entregar al usuario.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { createResetTokenForUser } from "@/lib/domains/password-reset";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const { id } = await ctx.params;
    return createResetTokenForUser(session.user.id, id);
  });
}
