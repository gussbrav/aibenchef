/**
 * POST /api/v1/admin/revalidate
 *
 * Invalida tags de Next.js (unstable_cache) desde procesos externos —
 * worker Python post-REFRESH de MVs, tareas de maintenance, etc.
 *
 * Auth: header `x-revalidate-secret` matching env.REVALIDATE_SECRET.
 *       Si la env no esta configurada el endpoint rechaza todo (fail-closed).
 *
 * Body: { tags: string[] }  — lista de tags a invalidar.
 *
 * Context (bug 2026-11-25):
 *   El /dashboard/informe cachea `getInformeData` con revalidate=4h. Despues
 *   de una ingesta SBS + REFRESH de MVs, los dashboards servian el snapshot
 *   viejo hasta expirar el TTL. Este endpoint cierra el loop: el pipeline
 *   Python llama aca con tags=["informe","periodos","entidades"] despues de
 *   cada refresh exitoso y los users ven la data nueva en segundos.
 */

import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const secret = env().REVALIDATE_SECRET;
    if (!secret) {
      throw new UnauthorizedError("REVALIDATE_SECRET no configurado", {});
    }
    const provided = req.headers.get("x-revalidate-secret");
    if (provided !== secret) {
      throw new UnauthorizedError("x-revalidate-secret invalido", {});
    }

    const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
    const tags = Array.isArray(body?.tags) ? body.tags : [];
    if (tags.length === 0 || !tags.every((t) => typeof t === "string" && t.length > 0)) {
      throw new ValidationError("body.tags requerido: string[] no vacio");
    }

    for (const tag of tags as string[]) {
      revalidateTag(tag);
    }
    return { ok: true, invalidated: tags };
  });
}
