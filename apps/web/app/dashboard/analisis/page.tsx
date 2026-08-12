import type { Metadata } from "next";

import { getServerSession, getUserPlan } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import { PlanUpgradePage } from "@/components/plan-upgrade-page";
import { AnalisisClient } from "./analisis-client";

export const metadata: Metadata = {
  title: "Analisis Dinamico",
};

export const dynamic = "force-dynamic";

export default async function AnalisisPage() {
  const session = await getServerSession().catch(() => null);
  if (session) {
    const admin = await isAdmin(session.user.id).catch(() => false);
    if (!admin) {
      const plan = await getUserPlan(session.user.id);
      if (plan === "free") {
        return (
          <PlanUpgradePage
            feature="Análisis dinámico"
            titulo="Análisis dinámico tipo pivot"
            descripcion="Compara entidades, períodos y métricas con tablas pivote sin escribir una sola línea de SQL. Ideal para explorar hipótesis rápido."
            bullets={[
              "Filas, columnas, valores y filtros como en Excel",
              "Cualquier combinación de métricas y períodos",
              "Exportá el resultado a Excel para seguir trabajando",
              "Guardado de vistas favoritas por usuario",
            ]}
            planRequerido="Pro"
          />
        );
      }
    }
  }

  return (
    <div className="-mx-4 -my-4">
      <AnalisisClient />
    </div>
  );
}
