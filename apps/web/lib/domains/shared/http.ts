/**
 * Helpers para route handlers Next.js — convierten DomainError a Response.
 *
 * Patron de uso en un route handler:
 *
 *   export async function POST(req: NextRequest) {
 *     return handleRoute(async () => {
 *       const body = await req.json();
 *       const result = await someService(body);
 *       return ok(result);
 *     });
 *   }
 */

import { NextResponse } from "next/server";
import { isDomainError, type DomainError } from "./errors";
import { logger } from "./logger";

const log = logger.child("http");

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function jsonError(error: DomainError): NextResponse {
  return NextResponse.json({ error: error.toJSON() }, { status: error.statusCode });
}

/**
 * Envuelve un handler async para que cualquier DomainError lanzado se
 * mapee a la respuesta HTTP correcta. Errores inesperados -> 500 + log.
 */
export async function handleRoute<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await fn();
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ data: result });
  } catch (e) {
    if (isDomainError(e)) {
      return jsonError(e);
    }
    log.error("unhandled_route_error", {
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    return NextResponse.json(
      { error: { code: "internal_error", message: "Error interno del servidor" } },
      { status: 500 },
    );
  }
}
