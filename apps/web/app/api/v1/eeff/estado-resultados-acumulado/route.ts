/**
 * GET /api/v1/eeff/estado-resultados-acumulado
 *   ?entidad=Banco%20de%20Credito&periodo=202604&moneda=TOTAL
 *
 * Devuelve el ER YTD del periodo con comparativa al mismo mes del año
 * anterior (Var S/, Var %, AV%).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { getEstadoResultadosAcumulado } from "@/lib/domains/er-acumulado";
import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entidad: z.string().min(1).max(200),
  periodo: z.coerce.number().int().min(200001).max(210012),
  moneda: z.enum(["MN", "ME", "TOTAL"]).optional().default("TOTAL"),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      entidad: url.searchParams.get("entidad"),
      periodo: url.searchParams.get("periodo"),
      moneda: url.searchParams.get("moneda") ?? undefined,
    });
    if (!parsed.success) {
      throw new ValidationError("Query invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return getEstadoResultadosAcumulado(parsed.data);
  });
}
