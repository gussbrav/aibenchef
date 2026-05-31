import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { deleteSheet, getSheet, updateSheetCells } from "@/lib/domains/sheets";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const chartSchema = z.object({
  id: z.string().min(1).max(64),
  tipo: z.enum(["line", "bar", "pie", "area"]),
  titulo: z.string().max(200).default(""),
  rango: z.string().regex(/^[A-Za-z]+\d+:[A-Za-z]+\d+$/, "Rango invalido (ej A1:C10)"),
  headerRow: z.boolean().default(true),
  xColumn: z.string().regex(/^[A-Za-z]+$/),
  config: z
    .object({
      ejeY: z
        .object({
          titulo: z.string().max(120).optional(),
          formato: z.enum(["number", "percent", "thousands"]).optional(),
        })
        .optional(),
      ejeX: z.object({ titulo: z.string().max(120).optional() }).optional(),
      colores: z.array(z.string().max(32)).max(20).optional(),
    })
    .default({}),
});

const patchBody = z.object({
  nombre: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  charts: z.array(chartSchema).max(30).optional(),
  nRows: z.number().int().min(10).max(10000).optional(),
  nCols: z.number().int().min(5).max(100).optional(),
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
    return getSheet(userId, id);
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
    return updateSheetCells(userId, id, parsed.data);
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { id } = await ctx.params;
    await deleteSheet(userId, id);
    return { deleted: true };
  });
}
