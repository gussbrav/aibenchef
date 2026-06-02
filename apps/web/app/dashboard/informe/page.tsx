import type { Metadata } from "next";
import { getInformeData, listPeriodosDisponibles, listEntidadesDisponibles } from "@/lib/domains/informe/queries";
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

export default async function InformeEjecutivoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // Default cliente = BCP (mayor participacion del sistema). El usuario
  // puede cambiarlo via ?cliente=<slug> o desde el selector de la UI.
  const clienteSlug = params.cliente ?? "bcp";

  // Si no hay periodo en URL, usar el ultimo disponible
  let periodo: number;
  if (params.periodo) {
    periodo = Number.parseInt(params.periodo, 10);
  } else {
    const periodos = await listPeriodosDisponibles({ ultimosN: 1 });
    periodo = periodos[0] ?? 202004;
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
      entidadPropiaOverride: params.entidadPropia,
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
