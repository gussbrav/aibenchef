"""SbsUrlBuilder — construye URLs y filenames de archivos publicados por SBS.

Patron descubierto de los .bat legacy:
    https://intranet2.sbs.gob.pe/estadistica/financiera/{anio}/{NombreMes}/{prefijo}-{codigo}-{abr}{anio}.xls

Cada .xls contiene la informacion de TODAS las entidades de un grupo
(no es por entidad individual).

EDPYMEs no captan depositos del publico -> sin DEPOSITOS ni CLIENTES_AHORRO.
"""

from __future__ import annotations

from dataclasses import dataclass

from aibenchef_data.domains.shared import NotFoundError

from .enums import Grupo, Topico
from .periodo import Periodo


@dataclass(frozen=True, slots=True)
class SbsFileRef:
    """Referencia inmutable a un archivo .xls publicado por SBS."""

    grupo: Grupo
    topico: Topico
    periodo: Periodo
    prefijo: str
    codigo: str

    @property
    def filename(self) -> str:
        return f"{self.prefijo}-{self.codigo}-{self.periodo.sbs_suffix}.xls"

    def url(self, base: str = "https://intranet2.sbs.gob.pe") -> str:
        return (
            f"{base}/estadistica/financiera/"
            f"{self.periodo.anio}/{self.periodo.nombre_mes}/{self.filename}"
        )


# Mapping (grupo, topico) -> (prefijo, codigo).
# Construido de los .bat legacy en `Extraer data de pagina SBS/Bacheros/`.
# None = ese (grupo, topico) no aplica (ej. EDPYMEs no captan depositos).
_URL_CODES: dict[tuple[Grupo, Topico], tuple[str, str] | None] = {
    # ---------- BANCA MULTIPLE ----------
    (Grupo.BANCA_MULTIPLE, Topico.EEFF): ("B", "2201"),
    (Grupo.BANCA_MULTIPLE, Topico.COLOCACIONES): ("B", "2334"),
    (Grupo.BANCA_MULTIPLE, Topico.DEPOSITOS): ("B", "2372"),
    (Grupo.BANCA_MULTIPLE, Topico.CASTIGOS): ("B", "2369"),
    (Grupo.BANCA_MULTIPLE, Topico.CLIENTES_CREDITO): ("B", "230803"),
    (Grupo.BANCA_MULTIPLE, Topico.CLIENTES_AHORRO): ("B", "2373"),
    (Grupo.BANCA_MULTIPLE, Topico.OFICINAS): ("B", "2303"),
    (Grupo.BANCA_MULTIPLE, Topico.CREDITOS_DEPOSITOS_GEO): ("B", "2358"),
    (Grupo.BANCA_MULTIPLE, Topico.PERSONAL): ("B", "2305"),
    (Grupo.BANCA_MULTIPLE, Topico.INDICADORES): ("B", "2401"),
    # ---------- EMPRESAS FINANCIERAS ----------
    (Grupo.FINANCIERA, Topico.EEFF): ("B", "3101"),
    (Grupo.FINANCIERA, Topico.COLOCACIONES): ("B", "3220"),
    (Grupo.FINANCIERA, Topico.DEPOSITOS): ("B", "3231"),
    (Grupo.FINANCIERA, Topico.CASTIGOS): ("B", "3234"),
    (Grupo.FINANCIERA, Topico.CLIENTES_CREDITO): ("B", "3218"),
    (Grupo.FINANCIERA, Topico.CLIENTES_AHORRO): ("B", "3232"),
    (Grupo.FINANCIERA, Topico.OFICINAS): ("B", "3201"),
    (Grupo.FINANCIERA, Topico.CREDITOS_DEPOSITOS_GEO): ("B", "3241"),
    (Grupo.FINANCIERA, Topico.PERSONAL): ("B", "3202"),
    (Grupo.FINANCIERA, Topico.INDICADORES): ("B", "3301"),
    # ---------- CAJAS MUNICIPALES ----------
    (Grupo.CMAC, Topico.EEFF): ("C", "1101"),
    (Grupo.CMAC, Topico.COLOCACIONES): ("C", "1228"),
    (Grupo.CMAC, Topico.DEPOSITOS): ("C", "1245"),
    (Grupo.CMAC, Topico.CASTIGOS): ("C", "1253"),
    (Grupo.CMAC, Topico.CLIENTES_CREDITO): ("C", "1231"),
    (Grupo.CMAC, Topico.CLIENTES_AHORRO): ("C", "1250"),
    (Grupo.CMAC, Topico.OFICINAS): ("C", "1201"),
    (Grupo.CMAC, Topico.CREDITOS_DEPOSITOS_GEO): ("C", "1234"),
    (Grupo.CMAC, Topico.PERSONAL): ("C", "1202"),
    (Grupo.CMAC, Topico.INDICADORES): ("C", "1301"),
    # ---------- CAJAS RURALES ----------
    (Grupo.CRAC, Topico.EEFF): ("C", "2101"),
    (Grupo.CRAC, Topico.COLOCACIONES): ("C", "2228"),
    (Grupo.CRAC, Topico.DEPOSITOS): ("C", "2250"),
    (Grupo.CRAC, Topico.CASTIGOS): ("C", "2258"),
    (Grupo.CRAC, Topico.CLIENTES_CREDITO): ("C", "2231"),
    (Grupo.CRAC, Topico.CLIENTES_AHORRO): ("C", "2255"),
    (Grupo.CRAC, Topico.OFICINAS): ("C", "2201"),
    (Grupo.CRAC, Topico.CREDITOS_DEPOSITOS_GEO): ("C", "2234"),
    (Grupo.CRAC, Topico.PERSONAL): ("C", "2202"),
    (Grupo.CRAC, Topico.INDICADORES): ("C", "2301"),
    # ---------- EDPYMEs ----------
    (Grupo.EDPYME, Topico.EEFF): ("C", "4103"),
    (Grupo.EDPYME, Topico.COLOCACIONES): ("C", "4223"),
    (Grupo.EDPYME, Topico.DEPOSITOS): None,         # no aplica
    (Grupo.EDPYME, Topico.CASTIGOS): ("C", "4242"),
    (Grupo.EDPYME, Topico.CLIENTES_CREDITO): ("C", "4226"),
    (Grupo.EDPYME, Topico.CLIENTES_AHORRO): None,   # no aplica
    (Grupo.EDPYME, Topico.OFICINAS): ("C", "4205"),
    (Grupo.EDPYME, Topico.CREDITOS_DEPOSITOS_GEO): ("C", "4228"),
    (Grupo.EDPYME, Topico.PERSONAL): ("C", "4206"),
    (Grupo.EDPYME, Topico.INDICADORES): ("C", "4301"),
}


class SbsUrlBuilder:
    """Construye SbsFileRef a partir de (grupo, topico, periodo)."""

    @staticmethod
    def is_published(grupo: Grupo, topico: Topico) -> bool:
        """Si la combinacion (grupo, topico) tiene archivo publicado por SBS."""
        return _URL_CODES.get((grupo, topico)) is not None

    @staticmethod
    def build(grupo: Grupo, topico: Topico, periodo: Periodo) -> SbsFileRef:
        codes = _URL_CODES.get((grupo, topico))
        if codes is None:
            raise NotFoundError(
                f"SBS no publica {topico.value} para {grupo.value}",
                context={"grupo": grupo.value, "topico": topico.value},
            )
        prefijo, codigo = codes
        return SbsFileRef(
            grupo=grupo,
            topico=topico,
            periodo=periodo,
            prefijo=prefijo,
            codigo=codigo,
        )

    @staticmethod
    def all_for_periodo(
        periodo: Periodo,
        grupos: list[Grupo] | None = None,
        topicos: list[Topico] | None = None,
    ) -> list[SbsFileRef]:
        """Genera todas las refs validas para un periodo, filtrando opcionalmente."""
        grupos_iter = grupos if grupos is not None else list(Grupo)
        topicos_iter = topicos if topicos is not None else list(Topico)
        refs: list[SbsFileRef] = []
        for g in grupos_iter:
            for t in topicos_iter:
                if SbsUrlBuilder.is_published(g, t):
                    refs.append(SbsUrlBuilder.build(g, t, periodo))
        return refs
