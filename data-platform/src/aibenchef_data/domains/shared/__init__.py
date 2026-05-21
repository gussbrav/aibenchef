"""Primitivos compartidos entre bounded contexts."""

from .errors import (
    DomainError,
    ValidationError,
    NotFoundError,
    ConflictError,
    ExternalServiceError,
    is_domain_error,
)
from .logger import configure_logging, get_logger
from .result import Result, Err, Ok

__all__ = [
    "DomainError",
    "ValidationError",
    "NotFoundError",
    "ConflictError",
    "ExternalServiceError",
    "is_domain_error",
    "configure_logging",
    "get_logger",
    "Result",
    "Ok",
    "Err",
]
