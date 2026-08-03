/**
 * GET /api/v1/informe/insights?periodo=X&seccion=Y&peerGroup=csv&entidadPropia=Z
 *
 * Devuelve el insight cacheado si existe. NO genera si falta —
 * ese es el flujo del POST /generate. Cache-only para evitar costos
 * accidentales en fetch inicial de la UI.
 *
 * Response: { insight: ReportInsight | null }
 */

import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { getCachedInsight, INSIGHT_SECCIONES, type InsightSeccion } from "@/lib/domains/insights";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const url = new URL(req.url);
    const periodoStr = url.searchParams.get("periodo");
    const seccion = url.searchParams.get("seccion");
    const peerGroupCsv = url.searchParams.get("peerGroup");
    const entidadPropia = url.searchParams.get("entidadPropia");

    if (!periodoStr) throw new ValidationError("periodo requerido");
    if (!seccion || !INSIGHT_SECCIONES.includes(seccion as InsightSeccion)) {
      throw new ValidationError(
        `seccion invalida. Validas: ${INSIGHT_SECCIONES.join(", ")}`,
      );
    }
    if (!peerGroupCsv) throw new ValidationError("peerGroup requerido (csv)");
    if (!entidadPropia) throw new ValidationError("entidadPropia requerida");

    const periodo = Number.parseInt(periodoStr, 10);
    const peerGroup = peerGroupCsv.split(",").map((s) => s.trim()).filter(Boolean);

    const insight = await getCachedInsight({
      periodo,
      seccion: seccion as InsightSeccion,
      peerGroup,
      entidadPropia,
    });

    // Nunca devolver contexto_json al cliente (puede tener data sensible)
    if (insight) {
      return {
        insight: {
          id: insight.id,
          periodo: insight.periodo,
          seccion: insight.seccion,
          bullets: insight.overrideBullets ?? insight.bullets,
          isOverride: Boolean(insight.overrideBullets),
          model: insight.model,
          generatedAt: insight.generatedAt,
          costUsd: insight.costUsd,
        },
      };
    }
    return { insight: null };
  });
}
