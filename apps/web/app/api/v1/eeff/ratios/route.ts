import type { NextRequest } from "next/server";
import { z } from "zod";

import { getRatios, getRatiosLatest } from "@/lib/domains/analytics";
import { getUltimoPeriodoPublicable } from "@/lib/domains/informe/queries";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { getPlanHistoricoBoundary, requireSession } from "@/lib/auth-helpers";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  entidad: z.string().optional(),
  tipo_entidad: z.string().optional(),
  moneda: z.enum(["MN", "ME", "TOTAL"]).optional(),
  desde: z.coerce.number().int().optional(),
  hasta: z.coerce.number().int().optional(),
  latest: z.coerce.boolean().optional(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireSession();
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new ValidationError("Parametros invalidos", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    if (parsed.data.latest || !parsed.data.entidad) {
      const rows = await getRatiosLatest({
        tipoEntidad: parsed.data.tipo_entidad,
        moneda: parsed.data.moneda,
      });
      return { rows, count: rows.length };
    }

    // Clamp de la ventana por plan: si el user pide desde antes del
    // earliest permitido, subimos el desde al earliest silenciosamente
    // (misma UX que /api/public/v1/entidades/[slug]/kpis).
    const latest = (await getUltimoPeriodoPublicable()) ?? parsed.data.hasta;
    let desdeFinal = parsed.data.desde;
    if (typeof latest === "number") {
      const earliest = await getPlanHistoricoBoundary(user.id, latest, user.role);
      if (earliest !== null && (!desdeFinal || desdeFinal < earliest)) {
        desdeFinal = earliest;
      }
    }

    const rows = await getRatios({
      entidad: parsed.data.entidad,
      moneda: parsed.data.moneda,
      desde: desdeFinal,
      hasta: parsed.data.hasta,
    });
    return { rows, count: rows.length };
  });
}
