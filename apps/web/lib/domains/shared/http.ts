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
 *
 * Mejora 2026-05: en dev y para errores con `code`/`detail` de postgres
 * incluimos el mensaje real (no solo "Error interno del servidor") para
 * facilitar debug. En prod los detalles tecnicos se preservan en logs
 * pero el cliente recibe un resumen utilizable.
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

    const err = e as Error & {
      code?: string;
      detail?: string;
      hint?: string;
      column?: string;
      table?: string;
      constraint?: string;
    };
    const dbCode = err.code; // postgres errors traen code (ej 23505 unique violation)
    const isDbError = typeof dbCode === "string" && /^\d{5}$/.test(dbCode);
    const isDev = process.env.NODE_ENV !== "production";

    log.error("unhandled_route_error", {
      message: err.message,
      stack: err.stack,
      ...(isDbError
        ? {
            db_code: dbCode,
            db_detail: err.detail,
            db_hint: err.hint,
            db_table: err.table,
            db_constraint: err.constraint,
          }
        : {}),
    });

    // En prod devolvemos un mensaje generico salvo que sea DB error conocido.
    let clientMessage = "Error interno del servidor";
    if (isDbError) {
      // Mensajes friendly para errores comunes
      switch (dbCode) {
        case "23505":
          clientMessage = `Ya existe un registro con esos datos${err.constraint ? ` (${err.constraint})` : ""}`;
          break;
        case "23503":
          clientMessage = `Referencia invalida${err.detail ? `: ${err.detail}` : ""}`;
          break;
        case "23502":
          clientMessage = `Falta un campo requerido${err.column ? `: ${err.column}` : ""}`;
          break;
        case "23514":
          clientMessage = `Valor invalido (constraint violado)${err.constraint ? `: ${err.constraint}` : ""}`;
          break;
        case "42703":
          clientMessage = `Columna desconocida${err.column ? `: ${err.column}` : ""}`;
          break;
        case "42P01":
          clientMessage = `Tabla desconocida`;
          break;
        case "42883":
          clientMessage = `Funcion u operador desconocido`;
          break;
        default:
          if (isDev) clientMessage = `DB error ${dbCode}: ${err.message}`;
      }
    } else if (isDev && err.message) {
      // Dev mode: mostrar el mensaje real para debug
      clientMessage = err.message;
    }

    return NextResponse.json(
      {
        error: {
          code: isDbError ? `db_${dbCode}` : "internal_error",
          message: clientMessage,
          ...(isDev && err.message !== clientMessage ? { detail: err.message } : {}),
        },
      },
      { status: 500 },
    );
  }
}
