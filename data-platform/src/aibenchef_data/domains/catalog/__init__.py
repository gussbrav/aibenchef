"""Domain catalog — entidades SBS, topicos, periodos.

Public API:
- Grupo, Topico (enums)
- Periodo (value object)
- Entidad (entity)
- EntidadesCatalog (repositorio in-memory cargado de seed JSON)
"""

from .enums import Grupo, Topico, MES_ABREV_SBS, MES_NOMBRE
from .periodo import Periodo
from .entidad import Entidad
from .repositories.entidades_catalog import EntidadesCatalog
from .sbs_url import SbsFileRef, SbsUrlBuilder

__all__ = [
    "Grupo",
    "Topico",
    "MES_ABREV_SBS",
    "MES_NOMBRE",
    "Periodo",
    "Entidad",
    "EntidadesCatalog",
    "SbsFileRef",
    "SbsUrlBuilder",
]
