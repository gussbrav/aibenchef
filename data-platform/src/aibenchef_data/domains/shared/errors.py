"""Jerarquia de errores del dominio (mirror del TS para consistencia)."""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Error de negocio esperado. Subclases definen code para mapping."""

    code: str = "domain_error"

    def __init__(self, message: str, context: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.context = context or {}

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": str(self), "context": self.context}


class ValidationError(DomainError):
    code = "validation_error"


class NotFoundError(DomainError):
    code = "not_found"


class ConflictError(DomainError):
    code = "conflict"


class ExternalServiceError(DomainError):
    """Falla externa esperada (HTTP 4xx/5xx, timeouts) que el caller maneja."""

    code = "external_service_error"


def is_domain_error(exc: BaseException) -> bool:
    return isinstance(exc, DomainError)
