import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { listUsers, requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);
    const rows = await listUsers();
    return { rows, count: rows.length };
  });
}
