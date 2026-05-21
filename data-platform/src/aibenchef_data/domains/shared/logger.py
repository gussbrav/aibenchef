"""Logger estructurado con structlog. Output JSON en prod, pretty en dev."""

from __future__ import annotations

import logging
import sys

import structlog

from aibenchef_data.env import settings


def configure_logging() -> None:
    """Configurar structlog + stdlib logging. Llamar una vez al startup."""
    cfg = settings()

    level = getattr(logging, cfg.log_level.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
    )

    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    if cfg.app_env == "development":
        processors.append(structlog.dev.ConsoleRenderer(colors=True))
    else:
        processors.append(structlog.processors.dict_tracebacks)
        processors.append(structlog.processors.JSONRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Obtener un logger con el contexto del modulo."""
    return structlog.get_logger(name)
