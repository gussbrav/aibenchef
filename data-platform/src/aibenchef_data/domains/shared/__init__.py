"""Primitivos compartidos entre bounded contexts."""

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
    "ConflictError",
    "DomainError",
    "Err",
    "ExternalServiceError",
    "NotFoundError",
    "Ok",
    "Result",
    "ValidationError",
    "configure_logging",
    "get_logger",
    "is_domain_error",
]
