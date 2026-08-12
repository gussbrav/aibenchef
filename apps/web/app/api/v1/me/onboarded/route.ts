import { sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth-helpers";
import { db } from "@/lib/infrastructure/db";
import { handleRoute } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/me/onboarded
 *
 * Marca al usuario como onboarded (setea onboarded_at = now() si estaba null).
 * Idempotente — llamarlo de nuevo no cambia el timestamp original.
 * Lo dispara el OnboardingModal al terminar el tour de bienvenida (V167).
 */
export async function POST() {
  return handleRoute(async () => {
    const user = await requireSession();
    await db.execute(sql`
      UPDATE auth.users
         SET onboarded_at = now()
       WHERE id = ${user.id}::uuid
         AND onboarded_at IS NULL
    `);
    return { ok: true };
  });
}
