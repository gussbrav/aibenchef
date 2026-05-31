/**
 * POST /api/v1/governance/glossary/seed
 *
 * Poblar el glossary desde el seed canonico (CANONICAL_GLOSSARY_SEED).
 * Idempotente — usa upsert por (schema, table, column).
 *
 * Solo admin. Audit event registrado.
 */

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  CANONICAL_GLOSSARY_SEED,
  getGlossary,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const glossary = getGlossary();
    let upserted = 0;
    for (const entry of CANONICAL_GLOSSARY_SEED) {
      await glossary.upsert(entry, session.user.id);
      upserted++;
    }

    await recordAuditEvent({
      category: "governance",
      action: "glossary_seed_applied",
      severity: "info",
      actorId: session.user.id,
      actorEmail: session.user.email,
      resource: "gov.business_glossary",
      metadata: { upserted },
    });

    return { upserted, total: CANONICAL_GLOSSARY_SEED.length };
  });
}
