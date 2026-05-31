/**
 * GET /api/v1/admin/access-requests — lista de solicitudes (admin).
 *   ?status=pending|approved|rejected|spam|all  (default: pending)
 *   ?search=texto  (busca en email, empresa, nombre)
 *   ?limit, ?offset
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  listAccessRequests,
  type AccessRequestStatus,
} from "@/lib/domains/access-requests";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const STATUS_VALUES = new Set<AccessRequestStatus | "all">([
  "pending",
  "approved",
  "rejected",
  "spam",
  "all",
]);

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status") ?? "pending";
    const status = STATUS_VALUES.has(statusParam as AccessRequestStatus | "all")
      ? (statusParam as AccessRequestStatus | "all")
      : "pending";
    const search = url.searchParams.get("search") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return listAccessRequests(session.user.id, { status, search, limit, offset });
  });
}
