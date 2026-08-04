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
import {
  getCachedInsight,
  getCurrentPromptVersion,
  INSIGHT_SECCIONES,
  type InsightSeccion,
} from "@/lib/domains/insights";

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

    // Cache stale (version del prompt cambio y no hay override) — tratar
    // como miss. La UI ofrecera regenerar y consumir la version nueva.
    const currentVersion = getCurrentPromptVersion(seccion as InsightSeccion);
    if (
      insight &&
      currentVersion &&
      insight.promptVersion !== currentVersion &&
      !insight.overrideBullets
    ) {
      return { insight: null };
    }

    // Nunca devolver contexto_json ni model/costo al cliente:
    // - contexto_json puede tener data sensible.
    // - model expone el LLM que usamos (opsec: no revelar stack).
    // - costUsd es info interna del operador, no del usuario del informe.
    if (insight) {
      return {
        insight: {
          id: insight.id,
          periodo: insight.periodo,
          seccion: insight.seccion,
          bullets: insight.overrideBullets ?? insight.bullets,
          isOverride: Boolean(insight.overrideBullets),
          generatedAt: insight.generatedAt,
        },
      };
    }
    return { insight: null };
  });
}
