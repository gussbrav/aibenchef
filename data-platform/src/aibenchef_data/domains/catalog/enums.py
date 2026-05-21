"""Enums del dominio: grupos de entidades + topicos publicados por SBS."""

from __future__ import annotations

from enum import StrEnum


class Grupo(StrEnum):
    """Grupos de entidades reguladas por la SBS."""

    BANCA_MULTIPLE = "banca_multiple"
    FINANCIERA = "financiera"
    CMAC = "cmac"
    CRAC = "crac"
    EDPYME = "edpyme"

    @property
    def label(self) -> str:
        return {
            Grupo.BANCA_MULTIPLE: "Banca Multiple",
            Grupo.FINANCIERA: "Empresas Financieras",
            Grupo.CMAC: "Cajas Municipales (CMAC)",
            Grupo.CRAC: "Cajas Rurales (CRAC)",
            Grupo.EDPYME: "EDPYMEs",
        }[self]

    @property
    def folder_seq(self) -> str:
        """Numero de la carpeta legacy: 01_, 02_, ..."""
        return {
            Grupo.BANCA_MULTIPLE: "01",
            Grupo.FINANCIERA: "02",
            Grupo.CMAC: "03",
            Grupo.CRAC: "04",
            Grupo.EDPYME: "05",
        }[self]


class Topico(StrEnum):
    """Topicos publicados mensualmente por la SBS por entidad."""

    EEFF = "eeff"
    COLOCACIONES = "colocaciones"
    DEPOSITOS = "depositos"
    CASTIGOS = "castigos"
    CLIENTES_CREDITO = "clientes_credito"
    CLIENTES_AHORRO = "clientes_ahorro"
    OFICINAS = "oficinas"
    CREDITOS_DEPOSITOS_GEO = "creditos_depositos_geo"
    PERSONAL = "personal"
    INDICADORES = "indicadores"

    @property
    def label(self) -> str:
        return {
            Topico.EEFF: "Estados Financieros",
            Topico.COLOCACIONES: "Colocaciones",
            Topico.DEPOSITOS: "Depositos",
            Topico.CASTIGOS: "Castigos",
            Topico.CLIENTES_CREDITO: "Clientes con Credito",
            Topico.CLIENTES_AHORRO: "Clientes con Ahorro",
            Topico.OFICINAS: "Oficinas y Geografia",
            Topico.CREDITOS_DEPOSITOS_GEO: "Creditos y Depositos por Oficina",
            Topico.PERSONAL: "Numero de Personal",
            Topico.INDICADORES: "Indicadores Regulatorios",
        }[self]

    @property
    def folder_seq(self) -> str:
        return {
            Topico.EEFF: "01",
            Topico.COLOCACIONES: "02",
            Topico.DEPOSITOS: "03",
            Topico.CASTIGOS: "04",
            Topico.CLIENTES_CREDITO: "05",
            Topico.CLIENTES_AHORRO: "06",
            Topico.OFICINAS: "07",
            Topico.CREDITOS_DEPOSITOS_GEO: "08",
            Topico.PERSONAL: "09",
            Topico.INDICADORES: "10",
        }[self]


# Abreviatura SBS por mes (1=en, 2=fe, ..., 12=di).
# Aparece en el nombre del archivo: B-2334-en2020.xls
MES_ABREV_SBS: dict[int, str] = {
    1: "en", 2: "fe", 3: "ma", 4: "ab", 5: "my", 6: "jn",
    7: "jl", 8: "ag", 9: "se", 10: "oc", 11: "no", 12: "di",
}

MES_NOMBRE: dict[int, str] = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Setiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}
