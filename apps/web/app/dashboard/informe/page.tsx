import type { Metadata } from "next";
import {
  getInformeData,
  getPeriodoCompletenessStatus,
  getUltimoPeriodoPublicable,
  listPeriodosDisponibles,
  listEntidadesDisponibles,
  parseColorsOverride,
} from "@/lib/domains/informe/queries";
import { InformeClient } from "./informe-client";

export const metadata: Metadata = {
  title: "Benchmark Ejecutivo",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  cliente?: string;
  periodo?: string;
  peerGroup?: string;
  entidadPropia?: string;
  tema?: string;
  orden?: string;
  consolidar?: string;
  /**
   * Override de colores por entidad. Formato CSV:
   *   ?colors=Banco%20de%20Cr%C3%A9dito%20del%20Per%C3%BA:0F2A5E,Caja%20Arequipa:FFB300
   * Permite customizar color de cualquier entidad sin tocar config.peer_group.
   */
  colors?: string;
  /** Alias retrocompat de `colors`. */
  colorOverrides?: string;
}>;

// Default sin ningun parametro URL: BCP como cliente + entidad resaltada.
// Forzamos los 3 niveles (slug + entidadPropia + nombreCorto) para que aunque
// config.cliente tenga datos viejos o getClienteBySlug devuelva fallback raro,
// la pagina siempre arranca con BCP cuando no hay parametros.
const BCP_DEFAULT = {
  slug: "bcp",
  entidadPropia: "Banco de Crédito del Perú",
} as const;

export default async function InformeEjecutivoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sinParams = !params.cliente && !params.entidadPropia;
  const clienteSlug = params.cliente ?? BCP_DEFAULT.slug;
  // Si NO hay params.entidadPropia Y NO hay params.cliente -> forzamos BCP.
  // Si vino params.cliente pero no params.entidadPropia, dejamos que getClienteBySlug
  // resuelva la entidad propia segun la config de ese cliente.
  const entidadPropiaOverride = params.entidadPropia
    ?? (sinParams ? BCP_DEFAULT.entidadPropia : undefined);

  // REGLA DE ORO V139: sin periodo en URL, arrancar en el ultimo mes con
  // EEFF publicado (>=4/5 grupos regulados). Los topicos secundarios
  // (castigos, tasas, geo, indicadores) que SBS publica con mas lag NO
  // bloquean — sus campos quedan en "—" si faltan, pero no privan al
  // usuario de ver los KPIs core del informe. Prioriza time-to-insight.
  let periodo: number;
  if (params.periodo) {
    periodo = Number.parseInt(params.periodo, 10);
  } else {
    periodo = (await getUltimoPeriodoPublicable()) ?? 202004;
  }

  const peerGroup = params.peerGroup
    ? params.peerGroup.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const orden = params.orden
    ? params.orden.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  // consolidar: default true. Solo se desactiva si viene "?consolidar=false".
  const consolidar = params.consolidar !== "false";

  // Colores ad-hoc del usuario: ?colors=Mibanco:0F2A5E,BCP:E91E63
  // Override transitorio en URL — no se persiste en DB.
  // Soportamos `colorOverrides` como alias retrocompat (era el nombre original).
  const colorsOverride = parseColorsOverride(params.colors ?? params.colorOverrides);

  // 4 queries en paralelo — el completenessStatus es la mas rapida (<10ms,
  // agregacion sobre raw.archivos_descargados con indice (periodo, topico,
  // status)) y NO extiende el wall-clock del render porque Promise.all
  // corre todas simultaneas. Impacto en TTFB: 0ms adicional.
  const [data, periodosDisponibles, entidadesDisponibles, completenessStatus] =
    await Promise.all([
      getInformeData({
        clienteSlug,
        periodo,
        peerGroupOverride: peerGroup,
        entidadPropiaOverride,
        temaOverride: params.tema,
        ordenOverride: orden,
        colorsOverride,
        consolidar,
      }),
      listPeriodosDisponibles({ ultimosN: 240 }),
      listEntidadesDisponibles({}),
      getPeriodoCompletenessStatus(periodo),
    ]);

  return (
    <InformeClient
      data={data}
      periodosDisponibles={periodosDisponibles}
      entidadesDisponibles={entidadesDisponibles}
      completenessStatus={completenessStatus}
    />
  );
}
