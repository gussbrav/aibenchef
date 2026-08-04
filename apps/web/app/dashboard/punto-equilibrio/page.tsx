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
  getPuntoEquilibrioComparativo,
  getPuntoEquilibrioHistoricoAnual,
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
  periodo?: string;
  desde?: string;
}>;

const BCP_DEFAULT = { slug: "bcp", entidadPropia: "Banco de Crédito del Perú" } as const;

export default async function PuntoEquilibrioPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Resolver cliente: URL > user default > BCP
  let userDefaultCliente: string | null = null;
  if (!params.cliente) {
    try {
      const session = await auth.api.getSession({ headers: await headers() });
      if (session) {
        const user = await getUser(session.user.id);
        userDefaultCliente = user.defaultClienteSlug;
      }
    } catch {
      /* fallback silencioso */
    }
  }
  const clienteSlug = params.cliente ?? userDefaultCliente ?? BCP_DEFAULT.slug;

  const cliente = await getClienteBySlug(clienteSlug);

  const periodo = params.periodo
    ? Number.parseInt(params.periodo, 10)
    : (await getUltimoPeriodoPublicable()) ?? 202412;

  const desdeAnio = params.desde
    ? Number.parseInt(params.desde, 10)
    : 2021;

  // Peer group para el comparativo
  const peerNames = await getDefaultPeerGroup(cliente.slug);

  // Data en paralelo: histórico de la entidad propia + comparativo peers
  const [historico, competidoresCon] = await Promise.all([
    getPuntoEquilibrioHistoricoAnual({
      entidad: cliente.entidadPropia,
      periodoActual: periodo,
      desdeAnio,
    }),
    (async () => {
      // Armar competidores con colores estables (mismo criterio que informe)
      const usados = new Set<string>();
      const conColores = peerNames.map((nombCorreg) => ({
        nombCorreg,
        color: pickColorEstable(nombCorreg, usados),
        esPropio: nombCorreg === cliente.entidadPropia,
      }));
      for (const c of conColores) usados.add(c.color);
      return conColores;
    })(),
  ]);

  const comparativo = await getPuntoEquilibrioComparativo({
    entidades: competidoresCon,
    periodo,
  });

  return (
    <PuntoEquilibrioClient
      cliente={cliente}
      periodo={{ codigo: periodo, label: formatPeriodo(periodo) }}
      historico={historico}
      comparativo={comparativo}
      desdeAnio={desdeAnio}
    />
  );
}

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function formatPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}
