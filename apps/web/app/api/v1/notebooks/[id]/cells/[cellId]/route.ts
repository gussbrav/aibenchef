import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { deleteCell, updateCell } from "@/lib/domains/notebooks";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const patchBody = z.object({
  contenido: z.string().max(50_000).optional(),
  config: z.record(z.string(), z.any()).optional(),
  fuenteCellId: z.string().nullable().optional(),
  orden: z.number().int().optional(),
});

type Ctx = { params: Promise<{ id: string; cellId: string }> };

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id, cellId } = await ctx.params;
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", { issues: parsed.error.flatten().fieldErrors });
    }
    return updateCell(userId, id, cellId, parsed.data);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id, cellId } = await ctx.params;
    await deleteCell(userId, id, cellId);
    return { deleted: true };
  });
}
