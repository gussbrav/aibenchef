/**
 * Result type — alternativa a throw/catch para flows de negocio esperados.
 *
 * Cuando un service puede fallar de manera predecible (ej. signin con
 * password equivocado), preferir devolver Result<T, DomainError> en lugar
 * de lanzar. Esto fuerza al caller a manejar el error explicitamente y
 * evita try/catch como control de flujo.
 *
 * Para errores inesperados (DB down, bug), seguir lanzando Error normal.
 */

import type { DomainError } from "./errors";

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/**
 * Helper para mapear el value de un Result sin tocar el error.
 */
export function mapOk<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}
