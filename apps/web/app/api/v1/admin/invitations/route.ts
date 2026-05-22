import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createInvitation, listInvitations } from "@/lib/domains/invitations";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const createBody = z.object({
  email: z.string().email().max(200),
  role: z.enum(["admin", "usuario"]).default("usuario"),
  notas: z.string().max(500).nullable().optional(),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function GET() {
  return handleRoute(async () => {
    const userId = await requireUserId();
    await requireAdmin(userId);
    const rows = await listInvitations();
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
    return createInvitation(userId, parsed.data);
  });
}
