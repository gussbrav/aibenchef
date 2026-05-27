/**
 * POST /api/v1/admin/pipeline/anomalias/:id/review
 *   body: { action: 'ignored' | 'cabecera_updated' | 'rename_added' |
 *                   'falsa_alarma' | 'otro',
 *           notes?: string }
 *
 * Marca una anomalia (admin.estructura_diffs) como revisada. El admin queda
 * registrado para audit (reviewed_by = email del usuario en sesion).
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import { reviewAnomalia } from "@/lib/domains/pipeline";
import type { AnomaliaReviewInput } from "@/lib/domains/pipeline";
import { handleRoute, NotFoundError, ValidationError } from "@/lib/domains/shared";

const ACCIONES_VALIDAS: AnomaliaReviewInput["action"][] = [
  "ignored",
  "cabecera_updated",
  "rename_added",
  "falsa_alarma",
  "otro",
];

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
      throw new ValidationError("id de anomalia invalido", {});
    }

    const body = (await req.json()) as Partial<AnomaliaReviewInput>;
    if (!body.action || !(ACCIONES_VALIDAS as string[]).includes(body.action)) {
      throw new ValidationError(
        `action debe ser una de: ${ACCIONES_VALIDAS.join(", ")}`,
        {},
      );
    }

    const { updated } = await reviewAnomalia(
      id,
      session.email,
      body.action,
      body.notes,
    );
    if (updated === 0) {
      throw new NotFoundError(
        "Anomalia no encontrada o ya estaba revisada",
        {},
      );
    }
    return { id, reviewedBy: session.email, action: body.action };
  });
}
