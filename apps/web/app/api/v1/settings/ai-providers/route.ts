import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { listProviders } from "@/lib/domains/ai-providers";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const rows = await listProviders();
    return { rows, count: rows.length };
  });
}
