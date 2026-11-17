import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import {
  getPeriodosDisponiblesSF,
  getPeriodosDisponiblesCOOPAC,
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

type SearchParams = Promise<{
  sf?: string;
  coopac?: string;
}>;

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

  const [periodosSF, periodosCoopac] = await Promise.all([
    getPeriodosDisponiblesSF(),
    getPeriodosDisponiblesCOOPAC(),
  ]);

  if (periodosSF.length === 0 && periodosCoopac.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-slate-500">
        No hay periodos disponibles aún.
      </div>
    );
  }

  // Periodo SF: URL param → más reciente disponible
  const sfParam = params.sf ? Number(params.sf) : null;
  const periodoSF =
    sfParam && periodosSF.some((p) => p.periodo === sfParam)
      ? sfParam
      : (periodosSF[0]?.periodo ?? 0);

  // Periodo COOPAC: URL param → más reciente disponible (independiente del SF)
  const coopacParam = params.coopac ? Number(params.coopac) : null;
  const periodoCoopac =
    coopacParam && periodosCoopac.some((p) => p.periodo === coopacParam)
      ? coopacParam
      : (periodosCoopac[0]?.periodo ?? 0);

  const [sf, coopac] = await Promise.all([
    periodoSF ? getEstadisticasSF(periodoSF) : Promise.resolve([]),
    periodoCoopac ? getEstadisticasCOOPAC(periodoCoopac) : Promise.resolve([]),
  ]);

  return (
    <EstadisticasRapidasClient
      sf={sf}
      coopac={coopac}
      periodoSF={periodoSF}
      periodoLabelSF={periodosSF.find((p) => p.periodo === periodoSF)?.label ?? ""}
      periodoCoopac={periodoCoopac}
      periodoLabelCoopac={periodosCoopac.find((p) => p.periodo === periodoCoopac)?.label ?? ""}
      periodosSF={periodosSF}
      periodosCoopac={periodosCoopac}
    />
  );
}
