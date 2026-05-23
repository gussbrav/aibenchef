import type { NextRequest } from "next/server";
import { z } from "zod";

import { listEntidades } from "@/lib/domains/analytics";
import { handleRoute, requireSession, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  tipo_entidad: z.string().optional(),
  solo_microfinancieras: z.coerce.boolean().optional(),
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
    const entidades = await listEntidades({
      tipoEntidad: parsed.data.tipo_entidad,
      soloMicrofinancieras: parsed.data.solo_microfinancieras,
    });
    return { entidades, count: entidades.length };
  });
}
