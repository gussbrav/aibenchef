import type { NextRequest } from "next/server";
import { z } from "zod";

import { listColumnasDisponibles, type FuentePivot } from "@/lib/domains/analytics";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { requireSession } from "@/lib/auth-helpers";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  fuente: z.enum(["balance", "resultados", "ratios"]),
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
    return listColumnasDisponibles(parsed.data.fuente as FuentePivot);
  });
}
