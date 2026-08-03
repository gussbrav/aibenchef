/**
 * POST /api/v1/informe/insights/generate
 *
 * Body: {
 *   periodo: number,
 *   seccion: InsightSeccion,
 *   clienteSlug: string,
 *   entidadPropia: string,
 *   peerGroup: string[],
 *   contexto: Record<string, unknown>
 * }
 *
 * Genera un insight (o retorna cache si ya existe). Response:
 *   { bullets: string[], model, tokensInput, tokensOutput, costUsd, fromCache }
 *
 * Errores:
 *   429 - Rate limit alcanzado (usuario o cliente)
 *   400 - Input invalido
 *   503 - No hay LLM provider configurado
 *   500 - Error del LLM
 */

import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, ValidationError, RateLimitError, ConflictError } from "@/lib/domains/shared";
import {
  generateInsight,
  InsightsError,
  INSIGHT_SECCIONES,
  type GenerateInsightInput,
  type InsightSeccion,
} from "@/lib/domains/insights";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    const body = (await req.json()) as Partial<GenerateInsightInput>;

    // Validacion
    if (typeof body.periodo !== "number" || body.periodo < 200001) {
      throw new ValidationError("periodo requerido (YYYYMM)");
    }
    if (!body.seccion || !INSIGHT_SECCIONES.includes(body.seccion as InsightSeccion)) {
      throw new ValidationError(
        `seccion invalida. Validas: ${INSIGHT_SECCIONES.join(", ")}`,
      );
    }
    if (!body.clienteSlug) throw new ValidationError("clienteSlug requerido");
    if (!body.entidadPropia) throw new ValidationError("entidadPropia requerida");
    if (!Array.isArray(body.peerGroup) || body.peerGroup.length === 0) {
      throw new ValidationError("peerGroup requerido (array no vacio)");
    }
    if (typeof body.contexto !== "object" || body.contexto === null) {
      throw new ValidationError("contexto requerido (object)");
    }

    try {
      const result = await generateInsight(body as GenerateInsightInput, {
        email: session.email ?? "unknown",
      });
      return result;
    } catch (err) {
      if (err instanceof InsightsError) {
        if (err.code === "rate_limit") {
          throw new RateLimitError(err.message, err.details ?? {});
        }
        if (err.code === "no_provider") {
          throw new ConflictError(err.message, { hint: "config en /admin/llm-settings" });
        }
        // parse_error, llm_error, unsupported_seccion -> propagar como conflict
        throw new ConflictError(err.message, err.details ?? {});
      }
      throw err;
    }
  });
}
