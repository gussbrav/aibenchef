import type { Metadata } from "next";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  getClienteBySlug,
  getDefaultPeerGroup,
  getUltimoPeriodoPublicable,
  pickColorEstable,
} from "@/lib/domains/informe/queries";
import {
  getPuntoEquilibrioHistorico,
  getPuntoEquilibrioSeries,
  listEntidadesConDataPE,
  type Granularidad,
} from "@/lib/domains/punto-equilibrio";
import { getUser } from "@/lib/domains/users";
import { PuntoEquilibrioClient } from "./client";

export const metadata: Metadata = {
  title: "Punto de Equilibrio",
  description:
    "Analisis historico del Punto de Equilibrio: rendimiento cartera vs costos (fondeo, provisiones, gastos operacionales).",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  cliente?: string;
  entidad?: string;
  periodo?: string;
  desde?: string;
  granularidad?: string;
  peers?: string;
  /** false = solo ventana legal del canonico (no incluye aliases historicos).
   *  true (default) = fusiona con renombres historicos (evolucion completa). */
  consolidar?: string;
}>;

const BCP_DEFAULT = { slug: "bcp", entidadPropia: "Banco de Crédito del Perú" } as const;

export default async function PuntoEquilibrioPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Resolver cliente por defecto (para el header + peer group)
  let userDefaultCliente: string | null = null;
  if (!params.cliente) {
    try {
      const session = await auth.api.getSession({ headers: await headers() });
      if (session) {
        const user = await getUser(session.user.id);
        userDefaultCliente = user.defaultClienteSlug;
      }
    } catch {
      /* fallback */
    }
  }
  const clienteSlug = params.cliente ?? userDefaultCliente ?? BCP_DEFAULT.slug;
  const cliente = await getClienteBySlug(clienteSlug);

  // Entidad a analizar: por default la del cliente, pero URL puede override
  const entidad = params.entidad ?? cliente.entidadPropia;

  // Periodo hasta: default ultimo publicado
  const hastaPeriodo = params.periodo
    ? Number.parseInt(params.periodo, 10)
    : (await getUltimoPeriodoPublicable()) ?? 202412;

  // Rango desde: default 5 años atras
  const anioActual = Math.floor(hastaPeriodo / 100);
  const desdeAnio = params.desde
    ? Number.parseInt(params.desde, 10)
    : Math.max(2009, anioActual - 5);

  const granularidad = (params.granularidad ?? "anual") as Granularidad;

  // consolidar: default true (PE es analisis historico — necesita evolucion
  // completa por default). Solo se desactiva si viene "?consolidar=false".
  const consolidar = params.consolidar !== "false";

  // Peer group:
  // - Modo historico (anual/mensual): default = top 2 del peer group SBS
  //   del cliente. Necesario para que el line chart tenga la banda de peers
  //   (min-max shaded area) de arranque, sin comparativa el grafico se ve
  //   plano y vacio.
  // - Modo "cierre unico": default vacio. El tab por defecto es "Cuadro por
  //   entidad" que es una comparativa EXPLICITA — imponer 2 peers automaticos
  //   (Financiera Compartamos + Mibanco para BCP) resulta enganoso porque
  //   el usuario cree que las eligio el, cuando en realidad son defaults.
  //   Fix reportado 2026-08-10.
  const peerGroup: string[] = await (async () => {
    if (params.peers) {
      return params.peers.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (granularidad === "cierre") {
      return [];
    }
    const defaults = await getDefaultPeerGroup(cliente.slug);
    return defaults.slice(0, 2);
  })();

  // Data inicial en paralelo
  const [historico, entidadesDisponibles, competidoresCon] = await Promise.all([
    getPuntoEquilibrioHistorico({
      entidad,
      desdeAnio,
      hastaPeriodo,
      granularidad,
      consolidar,
    }),
    listEntidadesConDataPE(),
    (async () => {
      const usados = new Set<string>();
      return peerGroup.map((nombCorreg) => {
        const color = pickColorEstable(nombCorreg, usados);
        usados.add(color);
        return {
          nombCorreg,
          color,
          esPropio: nombCorreg === entidad,
        };
      });
    })(),
  ]);

  const series = await getPuntoEquilibrioSeries({
    entidades: competidoresCon,
    desdeAnio,
    hastaPeriodo,
    granularidad,
    consolidar,
  });

  return (
    <PuntoEquilibrioClient
      cliente={cliente}
      entidadActual={entidad}
      periodo={{ codigo: hastaPeriodo, label: formatPeriodo(hastaPeriodo) }}
      historico={historico}
      series={series}
      entidadesDisponibles={entidadesDisponibles}
      config={{
        desdeAnio,
        hastaPeriodo,
        granularidad,
        peerGroup: peerGroup,
        consolidar,
      }}
    />
  );
}

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function formatPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}
