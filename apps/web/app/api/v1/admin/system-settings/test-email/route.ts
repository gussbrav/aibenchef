/**
 * POST /api/v1/admin/system-settings/test-email
 * Manda un email de prueba usando la configuracion SMTP/Resend actual.
 * Solo admins (requireAdmin via listSystemSettings o similar) — para no
 * duplicar el check usamos el guard del dominio.
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/domains/users";
import { testEmailConfig } from "@/lib/infrastructure/email";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z.string().email("El destinatario debe ser un email valido"),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return testEmailConfig(parsed.data.to);
  });
}
