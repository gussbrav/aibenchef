import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  deleteWorkspace,
  getWorkspace,
  updateWorkspace,
} from "@/lib/domains/workspaces";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const patchBody = z.object({
  nombre: z.string().min(1).max(120).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  config: z
    .object({
      fuente: z.enum(["balance", "resultados", "ratios"]),
      dimensiones: z.array(z.string()).min(1),
      medidas: z.array(z.string()).min(1),
      agregacion: z.enum(["NONE", "SUM", "AVG", "MIN", "MAX", "COUNT"]),
      filtros: z.any().optional(),
      formatoCondicional: z.any().optional(),
      charts: z.any().optional(),
    })
    .optional(),
  esDefault: z.boolean().optional(),
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
    return getWorkspace(userId, id);
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
    return updateWorkspace(userId, id, parsed.data as Parameters<typeof updateWorkspace>[2]);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    await deleteWorkspace(userId, id);
    return { deleted: true, id };
  });
}
