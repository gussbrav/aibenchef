import type { NextRequest } from "next/server";
import { z } from "zod";

import { runPivot, type AgregacionPivot, type FuentePivot } from "@/lib/domains/analytics";
import { handleRoute, requireSession, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const fuenteSchema = z.enum(["balance", "resultados", "ratios"]);
const agregacionSchema = z.enum(["NONE", "SUM", "AVG", "MIN", "MAX", "COUNT"]);

const bodySchema = z.object({
  fuente: fuenteSchema,
  dimensiones: z.array(z.string().min(1)).min(1).max(8),
  medidas: z.array(z.string().min(1)).min(1).max(50),
  agregacion: agregacionSchema.default("NONE"),
  filtros: z
    .object({
      tipoEntidad: z.array(z.string()).optional(),
      moneda: z.array(z.enum(["MN", "ME", "TOTAL"])).optional(),
      nombCorreg: z.array(z.string()).optional(),
      microfinanciera: z.boolean().optional(),
      periodoDesde: z.number().int().min(200001).max(210012).optional(),
      periodoHasta: z.number().int().min(200001).max(210012).optional(),
    })
    .optional(),
  limite: z.number().int().min(1).max(50_000).optional(),
  orden: z
    .array(z.object({ columna: z.string(), dir: z.enum(["ASC", "DESC"]) }))
    .optional(),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await runPivot({
      fuente: parsed.data.fuente as FuentePivot,
      dimensiones: parsed.data.dimensiones,
      medidas: parsed.data.medidas,
      agregacion: parsed.data.agregacion as AgregacionPivot,
      filtros: parsed.data.filtros,
      limite: parsed.data.limite,
      orden: parsed.data.orden,
    });
    return result;
  });
}
