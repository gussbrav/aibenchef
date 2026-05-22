import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { deleteWidget, updateWidget } from "@/lib/domains/tableros";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const tipoSchema = z.enum([
  "kpi",
  "chart_line",
  "chart_bar",
  "chart_pie",
  "chart_area",
  "chart_combo",
  "table",
  "markdown",
]);

const patchBody = z.object({
  tipo: tipoSchema.optional(),
  titulo: z.string().max(200).nullable().optional(),
  config: z.record(z.string(), z.any()).optional(),
  posX: z.number().int().min(0).max(12).optional(),
  posY: z.number().int().min(0).optional(),
  posW: z.number().int().min(1).max(12).optional(),
  posH: z.number().int().min(1).max(20).optional(),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

type Ctx = { params: Promise<{ id: string; widgetId: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id, widgetId } = await ctx.params;
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return updateWidget(userId, id, widgetId, parsed.data);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id, widgetId } = await ctx.params;
    await deleteWidget(userId, id, widgetId);
    return { deleted: true };
  });
}
