import type { NextRequest } from "next/server";

import { withApiPublic } from "@/lib/api-public/middleware";
import { getRatiosLatest, getRatios } from "@/lib/domains/analytics";
import { ValidationError } from "@/lib/domains/shared";
import { PLAN_LIMITS } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/benchmarks?entidades=X,Y,Z[&periodo=YYYYMM]
 *
 * Comparativa lado-a-lado de ratios anualizados para varias entidades en
 * un mismo periodo. Ideal para armar peer group + comparar (BCP vs BBVA
 * vs Interbank vs Scotiabank).
 *
 * Params:
 *   - entidades: CSV de nombres canonicos (obligatorio, 1-N)
 *   - periodo: YYYYMM (default = ultimo publicado)
 *
 * Enforcement plan:
 *   - Cap de peers: si entidades.length > PLAN_LIMITS[plan].maxPeers,
 *     truncamos a las primeras N y agregamos meta.planLimited=true.
 *   - Cap historico: no aplica aca porque devolvemos un solo periodo.
 *
 * Response: { data: { periodo, entidades: [{ nombre, roa, roe, mora, ... }] } }
 */
export async function GET(req: NextRequest) {
  return withApiPublic(req, async (ctx) => {
    const url = new URL(req.url);
    const entidadesStr = url.searchParams.get("entidades");
    if (!entidadesStr) {
      throw new ValidationError("entidades requerido (CSV de nombres)");
    }
    let entidades = entidadesStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (entidades.length === 0) {
      throw new ValidationError("entidades vacio");
    }
    if (entidades.length > 20) {
      throw new ValidationError("maximo 20 entidades por request");
    }

    // Enforcement de plan.
    const limits = PLAN_LIMITS[ctx.plan];
    const isAdmin = ctx.role === "admin";
    let planLimited = false;
    if (!isAdmin && limits && entidades.length > limits.maxPeers) {
      entidades = entidades.slice(0, limits.maxPeers);
      planLimited = true;
    }

    // Periodo: default ultimo
    const periodoStr = url.searchParams.get("periodo");
    let periodo: number | undefined;
    if (periodoStr) {
      periodo = Number.parseInt(periodoStr, 10);
      if (!Number.isFinite(periodo) || periodo < 200001) {
        throw new ValidationError("periodo invalido (YYYYMM >= 200001)");
      }
    }

    // Query en paralelo para cada entidad
    const filas = await Promise.all(
      entidades.map(async (entidad) => {
        if (periodo) {
          const rows = await getRatios({ entidad, hasta: periodo, desde: periodo });
          return rows[0] ?? { nombCorreg: entidad, periodo, noData: true };
        }
        const rows = await getRatiosLatest();
        return rows.find((r) => r.nombCorreg === entidad) ?? {
          nombCorreg: entidad,
          noData: true,
        };
      }),
    );

    return {
      periodo: periodo ?? null,
      entidades: filas,
      meta: {
        planLimited,
        plan: ctx.plan,
        maxPeers: limits?.maxPeers,
      },
    };
  });
}
