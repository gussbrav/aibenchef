/**
 * GET /api/v1/admin/system-settings — lista todas las settings (secrets masked)
 * PUT /api/v1/admin/system-settings — actualiza una setting por key
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import {
  listSystemSettings,
  updateSystemSetting,
} from "@/lib/domains/system-settings";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session;
}

export async function GET() {
  return handleRoute(async () => {
    const session = await requireSession();
    return listSystemSettings(session.user.id);
  });
}

const putBody = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(2000).nullable(),
});

export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await requireSession();
    const userId = session.user.id;
    const json = await req.json();
    const parsed = putBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await updateSystemSetting(userId, parsed.data.key, parsed.data.value);

    // Audit: cambio en configuracion global del sistema. Severidad warn
    // porque keys sensibles (smtp password, etc) pueden cambiarse aca.
    // NUNCA registramos el value en metadata (puede ser secret).
    const ctxAudit = extractAuditContext(hdrs, userId, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "system_setting_update",
      severity: "warn",
      resource: `system_setting:${parsed.data.key}`,
      metadata: { hasValue: parsed.data.value !== null },
    });

    return result;
  });
}
