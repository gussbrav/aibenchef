/**
 * Jerarquia de errores del dominio.
 *
 * Cada error tiene un `code` (machine-readable, snake_case) y un
 * `statusCode` HTTP para que el handler de API lo mapee directo.
 *
 * Convencion: lanzar DomainError en services/repos para problemas de
 * negocio. Errores tecnicos inesperados (DB down, parsing roto) que se
 * propaguen como Error nativo y se atrapen en el outer try/catch del
 * route handler.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): { code: string; message: string; context?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.context ? { context: this.context } : {}),
    };
  }
}

export class ValidationError extends DomainError {
  readonly code = "validation_error";
  readonly statusCode = 400;
}

export class UnauthorizedError extends DomainError {
  readonly code = "unauthorized";
  readonly statusCode = 401;
}

export class ForbiddenError extends DomainError {
  readonly code = "forbidden";
  readonly statusCode = 403;
}

export class NotFoundError extends DomainError {
  readonly code = "not_found";
  readonly statusCode = 404;
}

export class ConflictError extends DomainError {
  readonly code = "conflict";
  readonly statusCode = 409;
}

export class RateLimitError extends DomainError {
  readonly code = "rate_limit";
  readonly statusCode = 429;
}

export class EntitlementError extends DomainError {
  readonly code = "entitlement_required";
  readonly statusCode = 402;
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
