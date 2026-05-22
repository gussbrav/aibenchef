import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createWidget, updateWidgetsLayout } from "@/lib/domains/tableros";
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

const createBody = z.object({
  tipo: tipoSchema,
  titulo: z.string().max(200).nullable().optional(),
  config: z.record(z.string(), z.any()).optional(),
  posX: z.number().int().min(0).max(12).optional(),
  posY: z.number().int().min(0).optional(),
  posW: z.number().int().min(1).max(12).optional(),
  posH: z.number().int().min(1).max(20).optional(),
});

const layoutBody = z.object({
  layout: z.array(
    z.object({
      id: z.string(),
      x: z.number().int().min(0).max(12),
      y: z.number().int().min(0),
      w: z.number().int().min(1).max(12),
      h: z.number().int().min(1).max(20),
    }),
  ),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = createBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return createWidget(userId, id, parsed.data);
  });
}

// Bulk layout update — react-grid-layout dispara onLayoutChange con todo el grid
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    const json = await req.json();
    const parsed = layoutBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    await updateWidgetsLayout(userId, id, parsed.data.layout);
    return { ok: true };
  });
}
