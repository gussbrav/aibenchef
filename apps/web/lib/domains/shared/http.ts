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
 *
 * v3 (2026-05-22): request-id correlation + structured logs + git_sha en errores.
 */

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { isDomainError, type DomainError } from "./errors";
import { logger } from "./logger";

const log = logger.child("http");

function shortId(): string {
  // 12 chars de UUID — suficiente para correlacionar entre cliente y server
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function gitSha(): string | null {
  return process.env.GIT_SHA?.slice(0, 7) ?? null;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function jsonError(error: DomainError, requestId?: string): NextResponse {
  const headers = new Headers();
  if (requestId) headers.set("X-Request-Id", requestId);
  return NextResponse.json(
    { error: { ...error.toJSON(), requestId } },
    { status: error.statusCode, headers },
  );
}

/**
 * Envuelve un handler async para que cualquier DomainError lanzado se
 * mapee a la respuesta HTTP correcta. Errores inesperados -> 500 + log.
 *
 * Features:
 *  - Request-id unico generado por request (X-Request-Id header)
 *  - Structured logs con request_id, git_sha, duration_ms
 *  - DomainError -> mensaje friendly al cliente
 *  - Postgres errors mapeados a mensajes amigables (23505 unique, etc)
 *  - En dev: incluye stack + detail en la response
 *  - En prod: solo mensaje + requestId, los detalles van al log
 *
 * El cliente puede mostrar el requestId al usuario, que lo reporta a
 * soporte y el admin lo busca en los logs del server.
 */
export async function handleRoute<T>(fn: () => Promise<T>): Promise<NextResponse> {
  const requestId = shortId();
  const start = Date.now();

  try {
    const result = await fn();
    if (result instanceof NextResponse) {
      result.headers.set("X-Request-Id", requestId);
      return result;
    }
    return NextResponse.json(
      { data: result, requestId },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (e) {
    const durationMs = Date.now() - start;

    if (isDomainError(e)) {
      log.warn("domain_error", {
        request_id: requestId,
        code: e.code,
        status: e.statusCode,
        message: e.message,
        duration_ms: durationMs,
        git_sha: gitSha(),
      });
      return jsonError(e, requestId);
    }

    const err = e as Error & {
      code?: string;
      detail?: string;
      hint?: string;
      column?: string;
      table?: string;
      constraint?: string;
      severity?: string;
      schema?: string;
      where?: string;
      position?: string;
      query?: string;
    };
    const dbCode = err.code;
    const isDbError = typeof dbCode === "string" && /^[A-Z0-9]{5}$/.test(dbCode);
    const isDev = process.env.NODE_ENV !== "production";

    // Log estructurado completo — todo lo que ayude al diagnostico
    log.error("unhandled_route_error", {
      request_id: requestId,
      message: err.message,
      stack: err.stack,
      duration_ms: durationMs,
      git_sha: gitSha(),
      ...(isDbError
        ? {
            db_code: dbCode,
            db_detail: err.detail,
            db_hint: err.hint,
            db_table: err.table,
            db_schema: err.schema,
            db_column: err.column,
            db_constraint: err.constraint,
            db_severity: err.severity,
            db_position: err.position,
          }
        : {}),
    });

    // Mensaje al cliente
    let clientMessage = "Error interno del servidor";
    if (isDbError) {
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
          clientMessage = `Valor invalido${err.constraint ? ` (${err.constraint})` : ""}`;
          break;
        case "42703":
          clientMessage = `Columna desconocida${err.column ? `: ${err.column}` : ""}`;
          break;
        case "42P01":
          clientMessage = `Tabla desconocida${err.table ? `: ${err.table}` : ""}`;
          break;
        case "42883":
          clientMessage = `Funcion u operador desconocido`;
          break;
        case "42601":
          clientMessage = `Sintaxis SQL invalida`;
          break;
        case "42P07":
          clientMessage = `Objeto ya existe`;
          break;
        case "42501":
          clientMessage = `Permiso denegado`;
          break;
        case "42P02":
          clientMessage = `Parametro indefinido`;
          break;
        case "53300":
          clientMessage = `Demasiadas conexiones a la base de datos`;
          break;
        case "57014":
          clientMessage = `Query cancelada (timeout o usuario)`;
          break;
        default:
          if (isDev) clientMessage = `DB ${dbCode}: ${err.message}`;
          else clientMessage = `Error de base de datos (codigo ${dbCode})`;
      }
    } else if (isDev && err.message) {
      clientMessage = err.message;
    }

    return NextResponse.json(
      {
        error: {
          code: isDbError ? `db_${dbCode}` : "internal_error",
          message: clientMessage,
          requestId,
          gitSha: gitSha(),
          // Solo en dev: stack + detail completo para debug rapido
          ...(isDev
            ? {
                detail: err.message,
                stack: err.stack?.split("\n").slice(0, 10).join("\n"),
                ...(isDbError
                  ? {
                      dbDetail: err.detail,
                      dbHint: err.hint,
                      dbTable: err.table,
                      dbConstraint: err.constraint,
                    }
                  : {}),
              }
            : {
                // En prod: hint al usuario para reportar
                hint: `Reporta el requestId ${requestId} a soporte.`,
              }),
        },
      },
      {
        status: 500,
        headers: { "X-Request-Id": requestId },
      },
    );
  }
}
