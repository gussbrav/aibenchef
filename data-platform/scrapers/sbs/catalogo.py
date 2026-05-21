"""Catalogo de entidades, grupos y topicos SBS.

Estructura inicial cableada a partir de la carpeta legacy `Extraer data de pagina SBS/`.
Se enriquece tras la primera corrida del scraper con codigos reales descubiertos.
"""

from dataclasses import dataclass
from enum import StrEnum


class Grupo(StrEnum):
    BANCA_MULTIPLE = "banca_multiple"
    FINANCIERA = "financiera"
    CMAC = "cmac"
    CRAC = "crac"
    EDPYME = "edpyme"


class Topico(StrEnum):
    EEFF = "eeff"                             # 01_EEFF_SBS
    COLOCACIONES = "colocaciones"             # 02_COLOCACIONES_SBS
    DEPOSITOS = "depositos"                   # 03_DEPOSITOS_SBS
    CASTIGOS = "castigos"                     # 04_CASTIGOS_SBS
    CLIENTES_CREDITO = "clientes_credito"     # 05_CLIENTES_CREDITO_SBS
    CLIENTES_AHORRO = "clientes_ahorro"       # 06_CLIENTES_AHORRO_SBS
    OFICINAS = "oficinas"                     # 07_OFICINAS_ZONA_GEOGRAFICA_SBS
    CREDITOS_DEPOSITOS_GEO = "creditos_depositos_geo"  # 08_*
    PERSONAL = "personal"                     # 09_NUMERO_PERSONAL_SBS
    INDICADORES = "indicadores"               # 10_INDICADORES_SBS


@dataclass(frozen=True)
class Entidad:
    codigo_sbs: str
    nombre: str
    grupo: Grupo


# Stub inicial — se enriquece tras primer scrape de pagina catalogo SBS
ENTIDADES_CONOCIDAS_STUB: tuple[Entidad, ...] = (
    Entidad("2001", "Banco de Credito del Peru", Grupo.BANCA_MULTIPLE),
    Entidad("2002", "BBVA Peru", Grupo.BANCA_MULTIPLE),
    Entidad("2003", "Interbank", Grupo.BANCA_MULTIPLE),
    Entidad("2004", "Scotiabank Peru", Grupo.BANCA_MULTIPLE),
    Entidad("8001", "CMAC Arequipa", Grupo.CMAC),
    Entidad("8002", "CMAC Piura", Grupo.CMAC),
    Entidad("8003", "CMAC Trujillo", Grupo.CMAC),
)


MES_ABREV_SBS: dict[int, str] = {
    1: "en", 2: "fe", 3: "ma", 4: "ab", 5: "my", 6: "jn",
    7: "jl", 8: "ag", 9: "se", 10: "oc", 11: "no", 12: "di",
}
