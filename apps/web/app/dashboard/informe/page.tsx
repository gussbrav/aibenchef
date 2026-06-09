import type { Metadata } from "next";
import {
  getInformeData,
  getUltimoPeriodoCompleto,
  listPeriodosDisponibles,
  listEntidadesDisponibles,
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

  // Si no hay periodo en URL, usar el ULTIMO PERIODO COMPLETO de SBS.
  // No alcanza con "ultimo periodo con data EEFF" porque SBS publica con lag:
  // EEFF puede estar publicado para Abr 2026 pero colocaciones/depositos NO,
  // y el dashboard mostraria accordions vacias. f_ultimo_periodo_completo()
  // filtra periodos con cualquier archivo en estado no_publicado_sbs.
  let periodo: number;
  if (params.periodo) {
    periodo = Number.parseInt(params.periodo, 10);
  } else {
    periodo = (await getUltimoPeriodoCompleto()) ?? 202004;
  }

  const peerGroup = params.peerGroup
    ? params.peerGroup.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const orden = params.orden
    ? params.orden.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  // consolidar: default true. Solo se desactiva si viene "?consolidar=false".
  const consolidar = params.consolidar !== "false";

  const [data, periodosDisponibles, entidadesDisponibles] = await Promise.all([
    getInformeData({
      clienteSlug,
      periodo,
      peerGroupOverride: peerGroup,
      entidadPropiaOverride,
      temaOverride: params.tema,
      ordenOverride: orden,
      consolidar,
    }),
    listPeriodosDisponibles({ ultimosN: 240 }),
    listEntidadesDisponibles({}),
  ]);

  return (
    <InformeClient
      data={data}
      periodosDisponibles={periodosDisponibles}
      entidadesDisponibles={entidadesDisponibles}
    />
  );
}
