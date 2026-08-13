import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute } from "@/lib/domains/shared";
import { revokeApiKey } from "@/lib/domains/api-keys";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/settings/api-keys/{id} — revoca una key.
 * Idempotente. Solo el owner puede revocar sus propias keys.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireSession();
    const { id } = await params;
    await revokeApiKey({ userId: user.id, apiKeyId: id });
    return { ok: true };
  });
}
