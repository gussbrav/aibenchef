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
  getTrayectoria,
} from "@/lib/domains/estadisticas-rapidas";
import type {
  EjeMetrica,
  NivelCOOPAC,
} from "@/lib/domains/estadisticas-rapidas/types";
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
  // Matriz de trayectoria
  mNivel?: string;
  mX?: string;
  mY?: string;
  mVent?: string;
}>;

const NIVELES_VALIDOS: NivelCOOPAC[] = [
  "COOPAC_N1", "COOPAC_N2A", "COOPAC_N2B", "COOPAC_N3",
];
const METRICAS_VALIDAS: EjeMetrica[] = ["roe", "roa", "mora", "cobertura"];
const VENTANAS_VALIDAS = [3, 6, 12];

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

  // Parámetros de la matriz de trayectoria (con defaults sanos).
  const matrizNivel: NivelCOOPAC =
    (NIVELES_VALIDOS as string[]).includes(params.mNivel ?? "")
      ? (params.mNivel as NivelCOOPAC)
      : "COOPAC_N1";
  const matrizEjeX: EjeMetrica =
    (METRICAS_VALIDAS as string[]).includes(params.mX ?? "")
      ? (params.mX as EjeMetrica)
      : "roe";
  const matrizEjeY: EjeMetrica =
    (METRICAS_VALIDAS as string[]).includes(params.mY ?? "")
      ? (params.mY as EjeMetrica)
      : "mora";
  const matrizVentana = VENTANAS_VALIDAS.includes(Number(params.mVent))
    ? Number(params.mVent)
    : 12;

  const [sf, coopac, trayectoria] = await Promise.all([
    periodoSF ? getEstadisticasSF(periodoSF) : Promise.resolve([]),
    periodoCoopac ? getEstadisticasCOOPAC(periodoCoopac) : Promise.resolve([]),
    periodoCoopac
      ? getTrayectoria({
          tipoEntidad: matrizNivel,
          periodoActual: periodoCoopac,
          ejeX: matrizEjeX,
          ejeY: matrizEjeY,
          ventanaMeses: matrizVentana,
        })
      : Promise.resolve([]),
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
      trayectoria={trayectoria}
      matrizNivel={matrizNivel}
      matrizEjeX={matrizEjeX}
      matrizEjeY={matrizEjeY}
      matrizVentana={matrizVentana}
    />
  );
}
