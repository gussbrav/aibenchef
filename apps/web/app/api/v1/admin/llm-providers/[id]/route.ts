/**
 * PATCH  /api/v1/admin/llm-providers/[id]  - actualizar (incluye rotar api key)
 * DELETE /api/v1/admin/llm-providers/[id]  - eliminar
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, NotFoundError } from "@/lib/domains/shared";
import { deleteProvider, updateProvider, type LlmProviderInput } from "@/lib/domains/llm-vault";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  return handleRoute(async () => {
    const session = await requireSession();
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { id } = await ctx.params;

    const body = (await req.json()) as Partial<LlmProviderInput> & { rotateApiKey?: boolean };
    // La api_key solo se cifra/actualiza si el usuario explicitamente la
    // envio en el body (rotacion). Si viene undefined, se preserva la existente.

    const updated = await updateProvider(id, body, {
      email: session.email ?? "unknown",
      ip,
    });
    if (!updated) throw new NotFoundError("Provider no encontrado", { id });
    return { provider: updated };
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Params }) {
  return handleRoute(async () => {
    const session = await requireSession();
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { id } = await ctx.params;

    const ok = await deleteProvider(id, {
      email: session.email ?? "unknown",
      ip,
    });
    if (!ok) throw new NotFoundError("Provider no encontrado", { id });
    return { ok: true };
  });
}
