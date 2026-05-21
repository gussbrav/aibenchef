"""Periodo value object — mes-anio de cierre SBS."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Self

from dateutil.relativedelta import relativedelta

from aibenchef_data.domains.shared import ValidationError

from .enums import MES_ABREV_SBS, MES_NOMBRE

_YYYYMM_RE = re.compile(r"^(?P<anio>\d{4})(?P<mes>0[1-9]|1[0-2])$")


@dataclass(frozen=True, slots=True, order=True)
class Periodo:
    """Periodo mensual de la SBS. Inmutable, comparable, hashable.

    Representa un mes completo (ej: marzo 2024 = Periodo(2024, 3)).
    Convertible a int (202403), a fecha de cierre (ultimo dia del mes),
    a sufijo SBS (ma2024), etc.
    """

    anio: int
    mes: int

    def __post_init__(self) -> None:
        if not (1900 <= self.anio <= 2100):
            raise ValidationError(f"Anio fuera de rango: {self.anio}")
        if not (1 <= self.mes <= 12):
            raise ValidationError(f"Mes fuera de rango: {self.mes}")

    # ---------- factories ----------
    @classmethod
    def from_yyyymm(cls, raw: str | int) -> Self:
        s = str(raw)
        m = _YYYYMM_RE.match(s)
        if not m:
            raise ValidationError(f"Periodo invalido: {raw!r}. Esperaba YYYYMM.")
        return cls(int(m["anio"]), int(m["mes"]))

    @classmethod
    def from_date(cls, d: date) -> Self:
        return cls(d.year, d.month)

    @classmethod
    def previous_month(cls, from_date: date | None = None) -> Self:
        ref = from_date or datetime.now(UTC).date()
        prev = ref.replace(day=1) - relativedelta(months=1)
        return cls(prev.year, prev.month)

    # ---------- representaciones ----------
    def to_int(self) -> int:
        return self.anio * 100 + self.mes

    def __str__(self) -> str:
        return f"{self.anio:04d}{self.mes:02d}"

    @property
    def iso(self) -> str:
        return f"{self.anio:04d}-{self.mes:02d}"

    @property
    def sbs_suffix(self) -> str:
        """Sufijo como aparece en el filename SBS: 'ma2024' para marzo 2024."""
        return f"{MES_ABREV_SBS[self.mes]}{self.anio}"

    @property
    def nombre_mes(self) -> str:
        return MES_NOMBRE[self.mes]

    @property
    def cierre(self) -> date:
        """Ultimo dia del mes (fecha de cierre regulatorio)."""
        next_first = date(self.anio, self.mes, 1) + relativedelta(months=1)
        return next_first - relativedelta(days=1)

    # ---------- aritmetica ----------
    def next(self) -> Self:
        if self.mes == 12:
            return type(self)(self.anio + 1, 1)
        return type(self)(self.anio, self.mes + 1)

    def previous(self) -> Self:
        if self.mes == 1:
            return type(self)(self.anio - 1, 12)
        return type(self)(self.anio, self.mes - 1)

    def offset(self, months: int) -> Self:
        d = date(self.anio, self.mes, 1) + relativedelta(months=months)
        return type(self)(d.year, d.month)
