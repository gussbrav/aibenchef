import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireSession, getUserPlan } from "@/lib/auth-helpers";
import { handleRoute, EntitlementError, ValidationError } from "@/lib/domains/shared";
import {
  createApiKey,
  listApiKeys,
} from "@/lib/domains/api-keys";
import { PLAN_LIMITS } from "@/lib/plans";
import { isAdmin } from "@/lib/domains/users";

export const dynamic = "force-dynamic";

const postBody = z.object({
  name: z.string().min(1).max(80),
  note: z.string().max(200).nullable().optional(),
});

/**
 * GET /api/v1/settings/api-keys — lista las keys del user autenticado.
 * Incluye revocadas (para auditoria en UI).
 */
export async function GET() {
  return handleRoute(async () => {
    const user = await requireSession();
    return listApiKeys(user.id);
  });
}

/**
 * POST /api/v1/settings/api-keys — crea una nueva key.
 * Body: { name: string, note?: string }
 * Response: la key completa + plainToken (visible UNA VEZ).
 * Requiere plan con apiAccess=true (academic/pro/business/admin).
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireSession();
    const admin = await isAdmin(user.id).catch(() => false);
    if (!admin) {
      const plan = await getUserPlan(user.id);
      if (!PLAN_LIMITS[plan].apiAccess) {
        throw new EntitlementError(
          "Tu plan no incluye acceso a la API pública. Actualiza a Académico ($9/mes) o Pro ($149/mes).",
          { plan },
        );
      }
    }

    const json = await req.json();
    const parsed = postBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return createApiKey({
      userId: user.id,
      name: parsed.data.name,
      note: parsed.data.note ?? null,
    });
  });
}
