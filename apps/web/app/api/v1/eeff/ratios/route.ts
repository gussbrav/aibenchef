import type { NextRequest } from "next/server";
import { z } from "zod";

import { getRatios, getRatiosLatest } from "@/lib/domains/analytics";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { requireSession } from "@/lib/domains/shared/auth-helpers";
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
    await requireSession();
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

    const rows = await getRatios({
      entidad: parsed.data.entidad,
      moneda: parsed.data.moneda,
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
    });
    return { rows, count: rows.length };
  });
}
