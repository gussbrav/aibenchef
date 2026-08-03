/**
 * POST /api/v1/admin/llm-providers/[id]/set-default
 *
 * Marca un provider como default de su scope (global o cliente).
 * Automaticamente desmarca cualquier otro default del mismo scope.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, NotFoundError } from "@/lib/domains/shared";
import { setDefaultProvider } from "@/lib/domains/llm-vault";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function POST(_req: NextRequest, ctx: { params: Params }) {
  return handleRoute(async () => {
    const session = await requireSession();
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { id } = await ctx.params;

    const ok = await setDefaultProvider(id, {
      email: session.email ?? "unknown",
      ip,
    });
    if (!ok) throw new NotFoundError("Provider no encontrado", { id });
    return { ok: true };
  });
}
