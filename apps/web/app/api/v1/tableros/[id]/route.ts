import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { deleteTablero, getTablero, updateTablero } from "@/lib/domains/tableros";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const patchBody = z.object({
  nombre: z.string().min(1).max(120).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  tags: z.array(z.string()).optional(),
  esPublico: z.boolean().optional(),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    return getTablero(userId, id);
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return updateTablero(userId, id, parsed.data);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    await deleteTablero(userId, id);
    return { deleted: true, id };
  });
}
