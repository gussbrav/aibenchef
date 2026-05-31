/**
 * POST /api/v1/admin/pipeline/cabecera/align
 *   body: { tipoEstado, tipoEntidad, codigos: string[], periodoSrc, motivo? }
 *
 * Issue #28 — aplica dw.align_cabecera() para agregar/actualizar codigos
 * en dw.cabecera_maestra. Audit en admin.cabecera_audit_log.
 */

import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { alignCabecera } from "@/lib/domains/pipeline";
import type { CabeceraAlignInput, TipoEstado } from "@/lib/domains/pipeline";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

const TIPO_ESTADO_VALIDO: TipoEstado[] = ["balance", "resultados"];

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireAdminSession();
    const body = (await req.json()) as Partial<CabeceraAlignInput>;

    if (!body.tipoEstado || !(TIPO_ESTADO_VALIDO as string[]).includes(body.tipoEstado)) {
      throw new ValidationError(
        `tipoEstado debe ser uno de: ${TIPO_ESTADO_VALIDO.join(", ")}`,
        {},
      );
    }
    if (!body.tipoEntidad?.trim()) {
      throw new ValidationError("tipoEntidad requerido", {});
    }
    if (!Array.isArray(body.codigos) || body.codigos.length === 0) {
      throw new ValidationError("codigos requerido (array no vacio)", {});
    }
    if (!Number.isFinite(body.periodoSrc) || (body.periodoSrc ?? 0) < 200001) {
      throw new ValidationError("periodoSrc YYYYMM requerido", {});
    }
    if (body.codigos.length > 100) {
      throw new ValidationError("max 100 codigos por request", {});
    }

    const { changes } = await alignCabecera(
      body.tipoEstado,
      body.tipoEntidad,
      body.codigos,
      body.periodoSrc!,
      session.email,
      body.motivo,
    );

    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "schema",
      action: "cabecera_align",
      severity: "warn", // alinear cabecera afecta el parser y los marts
      resource: `dw.cabecera_maestra:${body.tipoEstado}:${body.tipoEntidad}`,
      metadata: {
        codigosCount: body.codigos.length,
        periodoSrc: body.periodoSrc,
        changes,
        hasMotivo: Boolean(body.motivo),
      },
    });

    return { changes };
  });
}
