"""Primitivos compartidos entre bounded contexts."""

from .carga_log import (
    CargaLogState,
    carga_log_context,
    mark_archivo_error,
    mark_archivo_procesado,
    resolve_archivo_id,
)
from .errors import (
    ConflictError,
    DomainError,
    ExternalServiceError,
    NotFoundError,
    ValidationError,
    is_domain_error,
)
from .logger import configure_logging, get_logger
from .result import Err, Ok, Result

__all__ = [
    "CargaLogState",
    "ConflictError",
    "DomainError",
    "Err",
    "ExternalServiceError",
    "NotFoundError",
    "Ok",
    "Result",
    "ValidationError",
    "carga_log_context",
    "configure_logging",
    "get_logger",
    "is_domain_error",
    "mark_archivo_error",
    "mark_archivo_procesado",
    "resolve_archivo_id",
]
