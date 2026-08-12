import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getUserPlan } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import { PlanUpgradePage } from "@/components/plan-upgrade-page";

import { AcumuladoClient } from "./acumulado-client";

export const metadata: Metadata = { title: "Estado de Resultados Acumulado" };
export const dynamic = "force-dynamic";

export default async function AcumuladoPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const admin = await isAdmin(session.user.id).catch(() => false);
  if (!admin) {
    const plan = await getUserPlan(session.user.id);
    if (plan === "free") {
      return (
        <PlanUpgradePage
          feature="ER Anualizado"
          titulo="Estado de Resultados anualizado"
          descripcion="Tendencia mensual del Estado de Resultados anualizado (últimos 12 meses móviles) para ver la evolución real de la rentabilidad."
          bullets={[
            "Ventana móvil 12 meses (elimina la estacionalidad mensual)",
            "Serie histórica de todos los rubros del ER",
            "Comparativa Pro (multi-entidad) y análisis de tendencias",
          ]}
          planRequerido="Pro"
        />
      );
    }
  }

  return <AcumuladoClient />;
}
