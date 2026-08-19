import type { NextRequest } from "next/server";
import { z } from "zod";

import { getBalance } from "@/lib/domains/analytics";
import { getUltimoPeriodoPublicable } from "@/lib/domains/informe/queries";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { assertPeriodoWithinPlanWindow, requireSession } from "@/lib/auth-helpers";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  entidad: z.string().min(1),
  periodo: z.coerce.number().int().min(200001).max(210012),
  moneda: z.enum(["MN", "ME", "TOTAL"]).optional(),
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
    // Ceiling de la ventana = ultimo periodo publicable (no el pedido —
    // sino el user pediria periodos viejos con su propio periodo como
    // ceiling y burlaria el cap).
    const latest = (await getUltimoPeriodoPublicable()) ?? parsed.data.periodo;
    await assertPeriodoWithinPlanWindow(
      user.id,
      parsed.data.periodo,
      latest,
      user.role,
    );
    return await getBalance({
      entidad: parsed.data.entidad,
      periodo: parsed.data.periodo,
      moneda: parsed.data.moneda,
    });
  });
}
