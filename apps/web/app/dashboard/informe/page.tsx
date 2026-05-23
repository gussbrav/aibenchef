import type { Metadata } from "next";
import { getInformeData, listPeriodosDisponibles, listEntidadesDisponibles } from "@/lib/domains/informe/queries";
import { InformeClient } from "./informe-client";

export const metadata: Metadata = {
  title: "Informe Ejecutivo",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  cliente?: string;
  periodo?: string;
  peerGroup?: string;
  entidadPropia?: string;
  tema?: string;
}>;

export default async function InformeEjecutivoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const clienteSlug = params.cliente ?? "caja-arequipa";

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

  const [data, periodosDisponibles, entidadesDisponibles] = await Promise.all([
    getInformeData({
      clienteSlug,
      periodo,
      peerGroupOverride: peerGroup,
      entidadPropiaOverride: params.entidadPropia,
      temaOverride: params.tema,
    }),
    listPeriodosDisponibles({ ultimosN: 36 }),
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
