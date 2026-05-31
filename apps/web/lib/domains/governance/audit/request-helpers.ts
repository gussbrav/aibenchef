/**
 * Helpers para integrar audit events desde Next.js API routes.
 *
 * Patron de uso:
 *
 *   const session = await auth.api.getSession({ headers: hdrs });
 *   const ctx = extractAuditContext(hdrs, session?.user?.id, session?.user?.email);
 *   ...
 *   await recordAuditEvent({
 *     ...ctx,
 *     category: "data_access",
 *     action: "sql_execute",
 *     resource: "raw.eeff_observacion",
 *     metadata: { rows },
 *   });
 *
 * Garantia: nunca throwa. Si la sesion no tiene user, deja actor* en null.
 */

import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

import type { AuditEventInput } from "./types";

/**
 * Subset del input que `extractAuditContext` produce. Los campos
 * `category` y `action` los completa el caller.
 */
export type AuditRequestContext = Pick<
  AuditEventInput,
  "actorId" | "actorEmail" | "ipAddress" | "traceId"
>;

/**
 * Extrae info de la request HTTP utilizable como contexto del audit event.
 *
 * - actorId / actorEmail: vienen de la session de Better Auth
 * - ipAddress: x-forwarded-for (Traefik / EasyPanel) o x-real-ip
 * - traceId: x-trace-id o x-request-id (si el proxy lo agrega)
 */
export function extractAuditContext(
  hdrs: ReadonlyHeaders | Headers,
  actorId?: string | null,
  actorEmail?: string | null,
): AuditRequestContext {
  return {
    actorId: actorId ?? null,
    actorEmail: actorEmail ?? null,
    ipAddress:
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      null,
    traceId: hdrs.get("x-trace-id") ?? hdrs.get("x-request-id") ?? null,
  };
}
