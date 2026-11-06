import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import {
  getPeriodosDisponibles,
  getEstadisticasSF,
  getEstadisticasCOOPAC,
} from "@/lib/domains/estadisticas-rapidas";
import { EstadisticasRapidasClient } from "./client";

export const metadata: Metadata = {
  title: "Estadísticas Rápidas",
  description:
    "Cuadro comparativo de indicadores clave por entidad y subsistema: cartera, mora, cobertura, ROE, ROA y más.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ periodo?: string }>;

export default async function EstadisticasRapidasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);

  if (!session) redirect("/login");

  const admin = await isAdmin(session.user.id).catch(() => false);
  if (!admin) {
    const plan = await getUserPlan(session.user.id);
    if (plan === "free") redirect("/dashboard?upgrade=estadisticas-rapidas");
  }

  const periodos = await getPeriodosDisponibles();
  if (periodos.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-slate-500">
        No hay periodos disponibles aún.
      </div>
    );
  }

  // Periodo seleccionado: URL param → más reciente disponible
  const periodoParam = params.periodo ? Number(params.periodo) : null;
  const periodoActual =
    periodoParam && periodos.some((p) => p.periodo === periodoParam)
      ? periodoParam
      : periodos[0].periodo;

  const [sf, coopac] = await Promise.all([
    getEstadisticasSF(periodoActual),
    getEstadisticasCOOPAC(periodoActual),
  ]);

  const periodoLabel =
    periodos.find((p) => p.periodo === periodoActual)?.label ?? String(periodoActual);

  return (
    <EstadisticasRapidasClient
      sf={sf}
      coopac={coopac}
      periodoActual={periodoActual}
      periodoLabel={periodoLabel}
      periodos={periodos}
    />
  );
}
