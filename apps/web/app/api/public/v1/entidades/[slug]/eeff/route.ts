import type { NextRequest } from "next/server";

import { withApiPublic } from "@/lib/api-public/middleware";
import { getBalance } from "@/lib/domains/analytics";
import { ValidationError } from "@/lib/domains/shared";
import { PLAN_LIMITS, earliestPeriodoForWindow } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/entidades/{slug}/eeff?periodo=YYYYMM[&moneda=TOTAL]
 *
 * Estados Financieros (Balance General) de una entidad para un periodo.
 * Devuelve las cuentas jerarquicas del plan contable SBS con sus valores.
 *
 * Params:
 *   - periodo: YYYYMM (obligatorio)
 *   - moneda: TOTAL (default) | MN | ME
 *
 * Enforcement de plan: el periodo debe caer dentro de la ventana permitida.
 *
 * Response: { data: { entidad, periodo, moneda, cuentas: [...] } }
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
    const periodoStr = url.searchParams.get("periodo");
    if (!periodoStr) throw new ValidationError("periodo requerido (YYYYMM)");
    const periodo = Number.parseInt(periodoStr, 10);
    if (!Number.isFinite(periodo) || periodo < 200001) {
      throw new ValidationError("periodo invalido (YYYYMM >= 200001)");
    }
    const moneda = (url.searchParams.get("moneda") ?? "TOTAL") as "TOTAL" | "MN" | "ME";
    if (!["TOTAL", "MN", "ME"].includes(moneda)) {
      throw new ValidationError("moneda invalida (TOTAL|MN|ME)");
    }

    // V168: enforcement de ventana historica. El periodo pedido no puede
    // ser mas antiguo que (hoy - maxHistoricoMeses). Admin bypass.
    const limits = PLAN_LIMITS[ctx.plan];
    const isAdmin = ctx.role === "admin";
    if (!isAdmin && limits && limits.maxHistoricoMeses < 999) {
      // Referencia: fecha actual como YYYYMM (usamos el server clock).
      const now = new Date();
      const hoy = now.getFullYear() * 100 + (now.getMonth() + 1);
      const min = earliestPeriodoForWindow(hoy, limits.maxHistoricoMeses);
      if (periodo < min) {
        throw new ValidationError(
          `El periodo ${periodo} esta fuera de la ventana permitida por tu plan (${ctx.plan}). Minimo permitido: ${min}.`,
        );
      }
    }

    const balance = await getBalance({ entidad, periodo, moneda });
    return {
      ...balance,
      entidad,
      periodo,
      moneda,
    };
  });
}
