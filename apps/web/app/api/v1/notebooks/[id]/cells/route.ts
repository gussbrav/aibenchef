import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createCell } from "@/lib/domains/notebooks";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const createBody = z.object({
  tipo: z.enum(["markdown", "sql", "chart"]),
  contenido: z.string().max(50_000).optional(),
  config: z.record(z.string(), z.any()).optional(),
  fuenteCellId: z.string().nullable().optional(),
  orden: z.number().int().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = createBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", { issues: parsed.error.flatten().fieldErrors });
    }
    return createCell(userId, id, parsed.data);
  });
}
