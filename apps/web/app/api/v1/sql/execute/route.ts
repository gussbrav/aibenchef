import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { executeQuerySandbox } from "@/lib/domains/sql-workbench";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sqlText: z.string().min(1).max(50_000),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    // Audit metadata: IP via x-forwarded-for (EasyPanel via Traefik) o
    // x-real-ip; user agent del header HTTP.
    const ip =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      null;
    const userAgent = hdrs.get("user-agent");
    return executeQuerySandbox(parsed.data.sqlText, {
      userId: session.user.id,
      ip,
      userAgent,
    });
  });
}
