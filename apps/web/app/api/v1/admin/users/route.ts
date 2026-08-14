import type { NextRequest } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  listUsers,
  listUsersPaged,
  requireAdmin,
  type ListUsersFilters,
  type ListUsersSort,
} from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";
import type { UserPlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/users
 *
 * Modo legacy (sin query params): devuelve la lista completa. Usado por el
 * panel viejo settings/users-section.tsx. Se mantiene por compatibilidad.
 *
 * Modo paginado (con al menos ?page o ?search): devuelve
 * { rows, total, page, pageSize } — usado por /dashboard/admin/suscripciones.
 * Permite filtrar por plan, role, status, activeInDays, expiringInDays.
 */
export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const url = new URL(req.url);
    const hasPagedParams =
      url.searchParams.has("page") ||
      url.searchParams.has("search") ||
      url.searchParams.has("plan") ||
      url.searchParams.has("role") ||
      url.searchParams.has("status") ||
      url.searchParams.has("sort") ||
      url.searchParams.has("activeInDays") ||
      url.searchParams.has("expiringInDays");

    if (!hasPagedParams) {
      const rows = await listUsers();
      return { rows, count: rows.length };
    }

    const filters: ListUsersFilters = {
      search: url.searchParams.get("search") ?? undefined,
      plan: (url.searchParams.get("plan") as UserPlan | "all" | null) ?? undefined,
      role: (url.searchParams.get("role") as "admin" | "usuario" | "all" | null) ?? undefined,
      status:
        (url.searchParams.get("status") as
          | "active"
          | "suspended"
          | "invited"
          | "all"
          | null) ?? undefined,
      activeInDays: url.searchParams.get("activeInDays")
        ? Number(url.searchParams.get("activeInDays"))
        : undefined,
      expiringInDays: url.searchParams.get("expiringInDays")
        ? Number(url.searchParams.get("expiringInDays"))
        : undefined,
    };
    const sort = (url.searchParams.get("sort") as ListUsersSort | null) ?? undefined;
    const page = url.searchParams.get("page")
      ? Number(url.searchParams.get("page"))
      : 1;
    const pageSize = url.searchParams.get("pageSize")
      ? Number(url.searchParams.get("pageSize"))
      : 25;

    return await listUsersPaged({ filters, sort, page, pageSize });
  });
}
