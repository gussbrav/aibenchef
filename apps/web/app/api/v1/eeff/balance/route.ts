import type { NextRequest } from "next/server";
import { z } from "zod";

import { getBalance } from "@/lib/domains/analytics";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { requireSession } from "@/lib/domains/shared/auth-helpers";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  entidad: z.string().min(1),
  periodo: z.coerce.number().int().min(200001).max(210012),
  moneda: z.enum(["MN", "ME", "TOTAL"]).optional(),
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
    return await getBalance({
      entidad: parsed.data.entidad,
      periodo: parsed.data.periodo,
      moneda: parsed.data.moneda,
    });
  });
}
