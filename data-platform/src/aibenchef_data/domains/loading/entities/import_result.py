"""ImportResult — resultado de una corrida del importer."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ImportResult:
    source: str
    source_file: str | None
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_skipped: int = 0
    duration_seconds: float = 0.0
    errors: tuple[str, ...] = field(default_factory=tuple)

    @property
    def succeeded(self) -> bool:
        return len(self.errors) == 0

    @property
    def total_rows(self) -> int:
        return self.rows_inserted + self.rows_updated + self.rows_skipped
