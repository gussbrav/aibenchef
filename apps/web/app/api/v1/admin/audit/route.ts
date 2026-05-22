import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { type AuditCategoria, listAuditEvents } from "@/lib/domains/audit";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const CATS_VALIDOS = new Set<AuditCategoria>(["users", "ai_providers", "sql", "genie"]);

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const url = new URL(req.url);
    const catsParam = url.searchParams.get("categorias");
    const categorias = catsParam
      ? (catsParam.split(",").filter((c) => CATS_VALIDOS.has(c as AuditCategoria)) as AuditCategoria[])
      : undefined;
    const limit = url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : undefined;
    const desde = url.searchParams.get("desde") ?? undefined;

    const events = await listAuditEvents({ categorias, limit, desde });
    return { rows: events, count: events.length };
  });
}
