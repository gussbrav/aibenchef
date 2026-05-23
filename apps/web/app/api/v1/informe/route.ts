import type { NextRequest } from "next/server";
import { z } from "zod";

import { getInformeData } from "@/lib/domains/informe/queries";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { requireSession } from "@/lib/domains/shared/auth-helpers";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  cliente: z.string().min(1).default("caja-arequipa"),
  periodo: z.coerce.number().int().min(200001).max(210012),
  peerGroup: z.string().optional(),
  entidadPropia: z.string().optional(),
  tema: z.string().optional(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new ValidationError("Parametros invalidos", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const peerGroup = parsed.data.peerGroup
      ? parsed.data.peerGroup.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    return await getInformeData({
      clienteSlug: parsed.data.cliente,
      periodo: parsed.data.periodo,
      peerGroupOverride: peerGroup,
      entidadPropiaOverride: parsed.data.entidadPropia,
      temaOverride: parsed.data.tema,
    });
  });
}
