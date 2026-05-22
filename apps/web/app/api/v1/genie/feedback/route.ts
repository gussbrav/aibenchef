import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { marcarFeedback } from "@/lib/domains/genie";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  id: z.number().int().positive(),
  feedback: z.union([z.literal(1), z.literal(-1)]),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    await marcarFeedback(session.user.id, parsed.data.id, parsed.data.feedback);
    return { ok: true };
  });
}
