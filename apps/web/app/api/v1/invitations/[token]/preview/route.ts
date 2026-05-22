import type { NextRequest } from "next/server";

import { previewInvitation } from "@/lib/domains/invitations";
import { handleRoute, NotFoundError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

// Endpoint PUBLICO (sin auth) — el frontend de signup lo llama para
// validar el token y pre-llenar el email. NO devuelve el token ni info
// sensible, solo email/role/expiracion.
export async function GET(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const { token } = await ctx.params;
    const preview = await previewInvitation(token);
    if (!preview) {
      throw new NotFoundError("Invitacion invalida o expirada", {});
    }
    return preview;
  });
}
