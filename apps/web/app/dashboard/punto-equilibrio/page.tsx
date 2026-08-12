import type { Metadata } from "next";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/auth-helpers";
import {
  getClienteBySlug,
  getUltimoPeriodoPublicable,
  listPeriodosDisponibles,
  pickColorEstable,
} from "@/lib/domains/informe/queries";
import {
  getPuntoEquilibrioHistorico,
  getPuntoEquilibrioSeries,
  listEntidadesConDataPE,
  type Granularidad,
} from "@/lib/domains/punto-equilibrio";
import { getUser, isAdmin } from "@/lib/domains/users";
import { PLAN_LIMITS } from "@/lib/plans";
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
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  let userDefaultCliente: string | null = null;
  if (!params.cliente && session) {
    try {
      const user = await getUser(session.user.id);
      userDefaultCliente = user.defaultClienteSlug;
    } catch {
      /* fallback */
    }
  }

  // Enforcement de plan (V167). Admin bypass.
  let maxPeers: number | undefined;
  let maxHistoricoMeses: number | undefined;
  if (session) {
    const admin = await isAdmin(session.user.id).catch(() => false);
    if (!admin) {
      const plan = await getUserPlan(session.user.id);
      maxPeers = PLAN_LIMITS[plan].maxPeers;
      maxHistoricoMeses = PLAN_LIMITS[plan].maxHistoricoMeses;
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

  // Rango desde: default 5 años atras.
  // Enforcement V167: si el plan limita la ventana historica (Free = 24
  // meses), clampeamos el desdeAnio para no permitir consultas mas
  // profundas. En Pro/Business/admin es undefined y no aplica.
  const anioActual = Math.floor(hastaPeriodo / 100);
  const mesActual = hastaPeriodo % 100;
  let desdeAnio = params.desde
    ? Number.parseInt(params.desde, 10)
    : Math.max(2009, anioActual - 5);
  let planLimitedHistorico = false;
  if (typeof maxHistoricoMeses === "number") {
    // El anio mas temprano permitido es el que contiene el mes
    // (hastaPeriodo - maxHistoricoMeses + 1). En Free (24m) con
    // hastaPeriodo=202606, minima ventana desde = 202407 → desdeAnio = 2024.
    const earliestPeriodo =
      anioActual * 100 + mesActual - maxHistoricoMeses + 1;
    const earliestAnio = Math.floor(
      earliestPeriodo > 0 ? earliestPeriodo / 100 : anioActual,
    );
    if (desdeAnio < earliestAnio) {
      planLimitedHistorico = true;
      desdeAnio = earliestAnio;
    }
  }

  const granularidad = (params.granularidad ?? "anual") as Granularidad;

  // consolidar: default true (PE es analisis historico — necesita evolucion
  // completa por default). Solo se desactiva si viene "?consolidar=false".
  const consolidar = params.consolidar !== "false";

  // Peer group: SIEMPRE vacio si no viene ?peers en la URL. Sin importar
  // el modo (cierre, anual o mensual). El usuario elige EXPLICITAMENTE
  // con quien comparar — nunca imponer defaults automaticos.
  //
  // Historia: antes cargabamos top-2 del peer group SBS del cliente cuando
  // no venia ?peers. Resultado: el usuario abria /punto-equilibrio y veia
  // "Financiera Compartamos + Mibanco" como comparativa aunque nunca las
  // eligio — engañoso. Fix reportado 2026-08-10.
  //
  // Trade-off aceptado: el line chart aparece vacio hasta que el usuario
  // agrega peers. Es preferible a la sorpresa de ver entidades ajenas.
  // El estado vacio tiene CTA claro ("Agrega entidades para comparar").
  let peerGroup: string[] = params.peers
    ? params.peers.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  let planLimited = planLimitedHistorico;
  if (typeof maxPeers === "number") {
    const otros = peerGroup.filter((n) => n !== entidad);
    if (otros.length > maxPeers) {
      planLimited = true;
      peerGroup = otros.slice(0, maxPeers);
    }
  }

  // Data inicial en paralelo
  const [historico, entidadesDisponibles, periodosDisponibles, competidoresCon] =
    await Promise.all([
      getPuntoEquilibrioHistorico({
        entidad,
        desdeAnio,
        hastaPeriodo,
        granularidad,
        consolidar,
      }),
      listEntidadesConDataPE(),
      listPeriodosDisponibles({ ultimosN: 240 }),
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
      periodosDisponibles={periodosDisponibles}
      config={{
        desdeAnio,
        hastaPeriodo,
        granularidad,
        peerGroup: peerGroup,
        consolidar,
      }}
      planLimited={planLimited}
      planMaxPeers={maxPeers}
      planMaxHistoricoMeses={maxHistoricoMeses}
    />
  );
}

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function formatPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}
