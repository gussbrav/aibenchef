import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { generarSqlDesdeNl } from "@/lib/domains/genie";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  prompt: z.string().min(1).max(5000),
  contextoExtra: z.string().max(2000).optional(),
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

    const result = await generarSqlDesdeNl(session.user.id, parsed.data);

    // Audit event — registra el uso de IA generativa con metadata util
    // sin guardar el prompt completo (el prompt va a app.genie_history).
    const ctx = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctx,
      category: "genie",
      action: "nl2sql_generate",
      severity: "info",
      resource: "genie:nl2sql",
      metadata: {
        promptLength: parsed.data.prompt.length,
        hasExtraContext: Boolean(parsed.data.contextoExtra),
      },
    });

    return result;
  });
}
