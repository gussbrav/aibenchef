import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createSavedQuery, listSavedQueries } from "@/lib/domains/sql-workbench";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const createBody = z.object({
  nombre: z.string().min(1).max(120),
  descripcion: z.string().max(500).nullable().optional(),
  sqlText: z.string().min(1).max(50_000),
  parametros: z.record(z.string(), z.any()).optional(),
  esPublico: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function GET() {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const rows = await listSavedQueries(userId);
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
    return createSavedQuery(userId, parsed.data);
  });
}
