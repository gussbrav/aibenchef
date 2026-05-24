"""Domain loading — escribe observaciones a raw.* en PostgreSQL.

Public API:
- ImportResult: resultado de una corrida
- BaseEeffImporter: importer del BASE EE.FF..xlsx
- BaseColocacionesImporter: importer del BASE COLOCACIONES.xlsx
- BaseDepositosImporter: importer del BASE DEPOSITOS.xlsx
- BaseCastigosImporter: importer del BASE CASTIGOS.xlsx
- MonthlyEeffImporter: importer de .xls mensuales SBS (topico 01)
- MonthlyOficinasImporter: importer de .xls mensuales SBS (topico 08)
- DimCuentaSeeder: pobla dw.dim_cuenta desde los seeds JSON
"""

from .entities.import_result import ImportResult
from .services.base_castigos_importer import BaseCastigosImporter
from .services.base_clientes_importers import (
    BaseClientesAhorrosImporter,
    BaseClientesCreditosImporter,
)
from .services.base_colocaciones_importer import BaseColocacionesImporter
from .services.base_depositos_importer import BaseDepositosImporter
from .services.base_eeff_importer import BaseEeffImporter
from .services.base_prudenciales_importers import (
    BasePatrimonioImporter,
    BasePersonalImporter,
    BaseRatioLiquidezImporter,
    BaseRcgImporter,
)
from .services.base_creditos_distrito_importer import BaseCreditosDistritoImporter
from .services.base_oficinas_importer import BaseOficinasImporter
from .services.base_tasas_activas_importer import BaseTasasActivasImporter
from .services.base_tasas_pasivas_importer import BaseTasasPasivasImporter
from .services.dim_cuenta_seeder import DimCuentaSeeder
from .services.monthly_eeff_importer import MonthlyEeffImporter
from .services.monthly_oficinas_importer import MonthlyOficinasImporter

__all__ = [
    "BaseCastigosImporter",
    "BaseClientesAhorrosImporter",
    "BaseClientesCreditosImporter",
    "BaseColocacionesImporter",
    "BaseCreditosDistritoImporter",
    "BaseDepositosImporter",
    "BaseEeffImporter",
    "BaseOficinasImporter",
    "BasePatrimonioImporter",
    "BasePersonalImporter",
    "BaseRatioLiquidezImporter",
    "BaseRcgImporter",
    "BaseTasasActivasImporter",
    "BaseTasasPasivasImporter",
    "DimCuentaSeeder",
    "ImportResult",
    "MonthlyEeffImporter",
    "MonthlyOficinasImporter",
]
