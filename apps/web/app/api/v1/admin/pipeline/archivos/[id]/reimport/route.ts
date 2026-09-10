/**
 * POST /api/v1/admin/pipeline/archivos/:id/reimport
 *
 * Marca un archivo sospechoso como 'descargado' para que el siguiente
 * ciclo de import lo re-procese. Util cuando SBS corrige un archivo
 * que ya estaba procesado pero con datos incorrectos.
 */

import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import { extractAuditContext, recordAuditEvent } from "@/lib/domains/governance";
import { markArchivoAsDescargado } from "@/lib/domains/admin";
import { handleRoute, NotFoundError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const session = await requireAdminSession();
    const { id } = await params;
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("id de archivo invalido", {});
    }

    const updated = await markArchivoAsDescargado(id);
    if (!updated) {
      throw new NotFoundError(
        "Archivo no encontrado o no estaba en estado sospechoso",
        {},
      );
    }

    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "archivo_sospechoso_reencolado",
      severity: "info",
      resource: `archivo:${id}`,
      metadata: { requeridoPor: session.email },
    });

    return { id, status: "descargado" };
  });
}
