/**
 * POST /api/v1/admin/pipeline/quality/:id/review
 *   body: { action: 'ignored' | 'fixed' | 'falsa_alarma' | 'sbs_publishing_quirk' | 'otro',
 *           notes?: string }
 *
 * Marca un quality check (admin.data_quality_checks) como revisado.
 */

import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { reviewQualityCheck } from "@/lib/domains/pipeline";
import { handleRoute, NotFoundError, ValidationError } from "@/lib/domains/shared";

const ACCIONES_VALIDAS = [
  "ignored",
  "fixed",
  "falsa_alarma",
  "sbs_publishing_quirk",
  "otro",
] as const;

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const session = await requireAdminSession();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError("id invalido", {});
    }

    const body = (await req.json()) as { action?: string; notes?: string };
    if (!body.action || !(ACCIONES_VALIDAS as readonly string[]).includes(body.action)) {
      throw new ValidationError(
        `action debe ser una de: ${ACCIONES_VALIDAS.join(", ")}`,
        {},
      );
    }

    const { updated } = await reviewQualityCheck(
      id,
      session.email,
      body.action,
      body.notes,
    );
    if (updated === 0) {
      throw new NotFoundError(
        "Quality check no encontrado o ya estaba revisado",
        {},
      );
    }

    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "schema",
      action: "pipeline_quality_reviewed",
      severity: "info",
      resource: `quality_check:${id}`,
      metadata: { action: body.action, hasNotes: Boolean(body.notes) },
    });

    return { id, reviewedBy: session.email, action: body.action };
  });
}
