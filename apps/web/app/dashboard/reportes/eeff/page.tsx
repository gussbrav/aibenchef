import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { db } from "@/lib/infrastructure/db";
import { ReporteEeffClient } from "./client";

export const metadata: Metadata = {
  title: "Reporte EEFF",
  description: "Exporta Balance, Estado de Resultados y Cartera Bruta a Excel para las entidades que elijas.",
};

export const dynamic = "force-dynamic";

type EntidadItem = {
  nombre: string;
  tipo: string;
  activa: boolean;
};

export default async function ReporteEeffPage() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) redirect("/login");
  const admin = await isAdmin(session.user.id).catch(() => false);
  if (!admin) redirect("/dashboard");

  const rows = await db.execute<{ nomb_correg_canonico: string; tipo_entidad_actual: string; activa: boolean }>(sql`
    SELECT nomb_correg_canonico, tipo_entidad_actual, activa
    FROM dw.entidad_maestra
    ORDER BY tipo_entidad_actual, nomb_correg_canonico
  `);

  const entidades: EntidadItem[] = rows.map(r => ({
    nombre:  String(r.nomb_correg_canonico),
    tipo:    String(r.tipo_entidad_actual),
    activa:  Boolean(r.activa),
  }));

  return <ReporteEeffClient entidades={entidades} />;
}
