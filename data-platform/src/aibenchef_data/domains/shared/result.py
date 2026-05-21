"""Result type — alternativa a try/except para flows esperados.

Pattern matching nativo de Python 3.10+ hace esto muy ergonomico:

    match service.do_something():
        case Ok(value):
            ...
        case Err(error):
            ...
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")
E = TypeVar("E")


@dataclass(frozen=True, slots=True)
class Ok(Generic[T]):
    value: T

    @property
    def ok(self) -> bool:
        return True


@dataclass(frozen=True, slots=True)
class Err(Generic[E]):
    error: E

    @property
    def ok(self) -> bool:
        return False


Result = Ok[T] | Err[E]
