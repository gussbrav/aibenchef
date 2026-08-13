import type { NextRequest } from "next/server";

import { withApiPublic } from "@/lib/api-public/middleware";
import { getRatios } from "@/lib/domains/analytics";
import { PLAN_LIMITS, earliestPeriodoForWindow } from "@/lib/plans";
import { ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/entidades/{slug}/kpis[?desde=YYYYMM&hasta=YYYYMM&moneda=TOTAL|MN|ME]
 *
 * Serie temporal de ratios anualizados (TTM) para una entidad:
 *   ROA, ROE, Mora, Cobertura CAR, Eficiencia, Apalancamiento, ...
 *
 * Filtros:
 *   - desde/hasta: periodo YYYYMM inclusivo. Sin filtro = toda la serie.
 *   - moneda: TOTAL (default) | MN | ME
 *
 * Enforcement de plan (V168):
 *   El rango 'desde' se clampea a la ventana permitida por el plan del
 *   user. Academic (60m) puede pedir desde 5 anios atras; Free no llega
 *   aqui porque no tiene apiAccess.
 *
 * Response: { data: [{ periodo, roa, roe, ratioMora, ... }, ...] }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return withApiPublic(req, async (ctx) => {
    const { slug } = await params;
    const entidad = decodeURIComponent(slug);
    if (!entidad || entidad.length > 200) {
      throw new ValidationError("slug de entidad invalido");
    }
    const url = new URL(req.url);
    const moneda = (url.searchParams.get("moneda") ?? "TOTAL") as "TOTAL" | "MN" | "ME";
    if (!["TOTAL", "MN", "ME"].includes(moneda)) {
      throw new ValidationError("moneda invalida (TOTAL|MN|ME)");
    }

    const desdeStr = url.searchParams.get("desde");
    const hastaStr = url.searchParams.get("hasta");
    const desde = desdeStr ? Number.parseInt(desdeStr, 10) : undefined;
    let hasta = hastaStr ? Number.parseInt(hastaStr, 10) : undefined;
    if (desdeStr && (!Number.isFinite(desde) || desde! < 200001)) {
      throw new ValidationError("desde invalido (YYYYMM >= 200001)");
    }
    if (hastaStr && (!Number.isFinite(hasta) || hasta! < 200001)) {
      throw new ValidationError("hasta invalido (YYYYMM >= 200001)");
    }

    // Enforcement de ventana por plan.
    const limits = PLAN_LIMITS[ctx.plan];
    const isAdmin = ctx.role === "admin";
    let desdeFinal = desde;
    if (!isAdmin && limits && limits.maxHistoricoMeses < 999 && hasta) {
      const minPermitido = earliestPeriodoForWindow(
        hasta,
        limits.maxHistoricoMeses,
      );
      if (!desdeFinal || desdeFinal < minPermitido) {
        desdeFinal = minPermitido;
      }
    }

    const rows = await getRatios({
      entidad,
      moneda,
      desde: desdeFinal,
      hasta,
    });
    return rows;
  });
}
