/**
 * POST /api/v1/auth/forgot-password { email }
 *
 * Endpoint PUBLICO. Self-service para que un usuario que olvido su
 * contrasena reciba un email con link de reset.
 *
 * Anti-enumeration: SIEMPRE devuelve { ok: true } sin importar si el
 * email existe o no. Un atacante NO puede usar este endpoint para saber
 * que emails estan registrados. La logica interna (rate limit, envio
 * de mail o no) queda opaca para el caller.
 *
 * Rate limit implicito: si ya hay un token activo de <60s para ese
 * user, no genera otro. Ver requestPasswordResetSelfService.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { requestPasswordResetSelfService } from "@/lib/domains/password-reset";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().min(3).max(200),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    // Best-effort — nunca propagamos error especifico al caller.
    // El resultado interno (emailSent, reason) va SOLO al audit log.
    const result = await requestPasswordResetSelfService(parsed.data.email)
      .catch(() => ({ emailSent: false, reason: "internal_error" }));

    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs);
    await recordAuditEvent({
      ...ctxAudit,
      category: "auth",
      action: "password_reset_requested",
      severity: "info",
      resource: `email:${parsed.data.email.slice(0, 3)}***`,
      metadata: { emailSent: result.emailSent, reason: result.reason ?? null },
    });

    // Respuesta unica sin importar si emailSent=true o false. La UI
    // muestra el mismo mensaje 'si el email existe, te llegara un link'.
    return { ok: true };
  });
}
