import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createWorkspace, listWorkspaces } from "@/lib/domains/workspaces";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const configSchema = z.object({
  fuente: z.enum(["balance", "resultados", "ratios"]),
  dimensiones: z.array(z.string()).min(1),
  medidas: z.array(z.string()).min(1),
  agregacion: z.enum(["NONE", "SUM", "AVG", "MIN", "MAX", "COUNT"]),
  filtros: z
    .object({
      tipoEntidad: z.array(z.string()).optional(),
      moneda: z.array(z.enum(["MN", "ME", "TOTAL"])).optional(),
      nombCorreg: z.array(z.string()).optional(),
      microfinanciera: z.boolean().optional(),
      periodoDesde: z.number().int().optional(),
      periodoHasta: z.number().int().optional(),
    })
    .optional(),
  formatoCondicional: z.record(z.string(), z.any()).optional(),
  charts: z.array(z.any()).optional(),
});

const createBody = z.object({
  nombre: z.string().min(1).max(120),
  descripcion: z.string().max(500).nullable().optional(),
  config: configSchema,
  esDefault: z.boolean().optional(),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function GET() {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const rows = await listWorkspaces(userId);
    return { rows, count: rows.length };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const json = await req.json();
    const parsed = createBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const ws = await createWorkspace(userId, parsed.data);
    return ws;
  });
}
