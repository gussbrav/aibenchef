"""Domain catalog — entidades SBS, topicos, periodos, plan de cuentas.

Public API:
- Grupo, Topico (enums)
- Periodo (value object)
- Entidad (entity)
- Cuenta + TipoEstado (cuenta canonica del plan SBS)
- EntidadesCatalog (repositorio in-memory)
- SbsFileRef + SbsUrlBuilder (mapping URLs SBS)
"""

from .cuenta import Cuenta, TipoEstado
from .entidad import Entidad
from .enums import MES_ABREV_SBS, MES_NOMBRE, Grupo, Topico
from .periodo import Periodo
from .repositories.entidades_catalog import EntidadesCatalog
from .sbs_url import SbsFileRef, SbsUrlBuilder

__all__ = [
    "Grupo",
    "Topico",
    "MES_ABREV_SBS",
    "MES_NOMBRE",
    "Periodo",
    "Entidad",
    "Cuenta",
    "TipoEstado",
    "EntidadesCatalog",
    "SbsFileRef",
    "SbsUrlBuilder",
]
