/**
 * GET /api/v1/genie/diagnose
 *
 * Diagnostico ligero: pregunta a resolveProvider que pasaria SIN ejecutar
 * el LLM. Util para que el frontend muestre proactivamente un banner si
 * Genie no esta configurado, en lugar de descubrirlo recien al primer
 * "Generar" del usuario.
 *
 * Responde: { ok: true, provider, modelo } o { ok: false, motivo }.
 * Nunca expone secrets — solo el provider id y modelo.
 */

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { diagnoseProvider } from "@/lib/domains/genie";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    return diagnoseProvider();
  });
}
