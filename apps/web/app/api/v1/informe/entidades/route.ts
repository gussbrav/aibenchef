import type { NextRequest } from "next/server";
import { z } from "zod";

import { listEntidadesDisponibles } from "@/lib/domains/informe/queries";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { requireSession } from "@/lib/auth-helpers";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  periodo: z.coerce.number().int().min(200001).max(210012).optional(),
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
    const entidades = await listEntidadesDisponibles({ periodo: parsed.data.periodo });
    return { entidades };
  });
}
