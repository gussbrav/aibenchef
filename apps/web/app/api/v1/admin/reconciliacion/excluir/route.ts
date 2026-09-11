/**
 * PATCH /api/v1/admin/reconciliacion/excluir
 *   body: { nombCorreg: string, excluida: boolean, motivoExclusion?: string | null }
 *
 * Marca o restaura la exclusion de una entidad en el sistema de
 * reconciliacion de ratios. Afecta TODOS los periodos e indicadores
 * de esa entidad (la exclusion es por entidad, no por periodo).
 *
 * Motivos validos al excluir: liquidacion | intervencion_sbs |
 *   fusion_absorcion | metodologia_diferente | otro
 */

import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { markExclusion } from "@/lib/domains/ratio-reconciliation";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

const MOTIVOS_VALIDOS = [
  "liquidacion",
  "intervencion_sbs",
  "fusion_absorcion",
  "metodologia_diferente",
  "otro",
] as const;

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireAdminSession();

    const body = (await req.json()) as {
      nombCorreg?: unknown;
      excluida?: unknown;
      motivoExclusion?: unknown;
    };

    if (typeof body.nombCorreg !== "string" || !body.nombCorreg.trim()) {
      throw new ValidationError("nombCorreg es requerido", {});
    }
    if (typeof body.excluida !== "boolean") {
      throw new ValidationError("excluida debe ser boolean", {});
    }
    if (
      body.excluida &&
      (typeof body.motivoExclusion !== "string" ||
        !(MOTIVOS_VALIDOS as readonly string[]).includes(body.motivoExclusion))
    ) {
      throw new ValidationError(
        `motivoExclusion requerido al excluir. Valores validos: ${MOTIVOS_VALIDOS.join(", ")}`,
        {},
      );
    }

    const nombCorreg = body.nombCorreg.trim();
    const excluida = body.excluida;
    const motivoExclusion =
      excluida && typeof body.motivoExclusion === "string"
        ? body.motivoExclusion
        : null;

    const { updated } = await markExclusion(nombCorreg, excluida, motivoExclusion);

    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "schema",
      action: excluida
        ? "reconciliacion_entidad_excluida"
        : "reconciliacion_entidad_restaurada",
      severity: "info",
      resource: `ratio_reconciliation:${nombCorreg}`,
      metadata: {
        excluida,
        motivoExclusion,
        rowsAfectados: updated,
      },
    });

    return { nombCorreg, excluida, motivoExclusion, updated };
  });
}
