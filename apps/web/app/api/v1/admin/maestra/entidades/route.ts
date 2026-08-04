/**
 * POST /api/v1/admin/maestra/entidades
 *
 * Registra una nueva entidad canonica en dw.entidad_maestra + los nombres
 * asociados en dw.entidad_nombre. Opcionalmente marca una entidad vieja
 * como reemplazada (caso conversion regulatoria).
 *
 * Body:
 *   {
 *     nombreCanonico: string,               // "Banco Efectiva"
 *     razonSocial?: string,                 // "BANCO EFECTIVA S.A."
 *     tipoEntidad: 'BANCOS' | 'FINANCIERAS' | 'CMAC' | 'CRAC' | 'EDPYMES' | ...,
 *     nombreRawSbs?: string,                // "BANCO EFECTIVA" tal cual SBS
 *     esMicrofinanciera?: boolean,
 *     codigoSbs?: string,
 *     notas?: string,
 *     reemplazaEntidadId?: number,          // id de Financiera Efectiva
 *     fechaBajaReemplaza?: string,          // "2026-05-31"
 *   }
 *
 * GET /api/v1/admin/maestra/entidades
 *
 * Lista todas las entidades (id + nombre + tipo + activa) para poblar
 * dropdowns en la UI (ej. selector 'Reemplaza a').
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createEntidad, listEntidades } from "@/lib/domains/maestra";
import { requireAdmin } from "@/lib/domains/users";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const createBody = z.object({
  nombreCanonico: z.string().min(1).max(200),
  razonSocial: z.string().max(300).nullable().optional(),
  tipoEntidad: z.enum([
    "BANCOS",
    "FINANCIERAS",
    "CMAC",
    "CRAC",
    "EDPYMES",
    "BANCO_NACION",
    "OTRO",
  ]),
  nombreRawSbs: z.string().max(200).nullable().optional(),
  esMicrofinanciera: z.boolean().optional(),
  codigoSbs: z.string().max(50).nullable().optional(),
  notas: z.string().max(1000).nullable().optional(),
  reemplazaEntidadId: z.number().int().positive().nullable().optional(),
  fechaBajaReemplaza: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser YYYY-MM-DD")
    .nullable()
    .optional(),
});

async function requireAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  await requireAdmin(session.user.id);
  return session;
}

export async function GET() {
  return handleRoute(async () => {
    await requireAdminSession();
    const rows = await listEntidades();
    return { rows, count: rows.length };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await requireAdminSession();
    const json = await req.json().catch(() => ({}));
    const parsed = createBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await createEntidad(
      { email: session.user.email },
      parsed.data,
    );

    // Audit — quien registro que entidad y con que reemplazo
    const ctxAudit = extractAuditContext(hdrs, session.user.id, session.user.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "admin",
      action: "maestra_entidad_created",
      severity: "info",
      resource: `entidad:${result.id}`,
      metadata: {
        nombreCanonico: result.nombreCanonico,
        tipoEntidad: parsed.data.tipoEntidad,
        reemplazaEntidadId: result.reemplazaId,
      },
    });

    return result;
  });
}
