import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { db } from "@/lib/infrastructure/db";
import { ReporteCastigosClient } from "./client";

export const metadata: Metadata = {
  title: "Reporte Castigos SF",
  description: "Exporta castigos mensuales por entidad y línea de producto a Excel.",
};

export const dynamic = "force-dynamic";

type EntidadItem = { nombre: string; tipo: string };

export default async function ReporteCastigosPage() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) redirect("/login");
  const admin = await isAdmin(session.user.id).catch(() => false);
  if (!admin) redirect("/dashboard");

  const rows = await db.execute<{ entidad: string; tipo_entidad: string }>(sql`
    SELECT DISTINCT
      COALESCE(entidad_final, entidad) AS entidad,
      tipo_entidad
    FROM raw.castigos_observacion
    ORDER BY tipo_entidad, entidad
  `);

  const rangoRows = await db.execute<{ min_periodo: number; max_periodo: number }>(sql`
    SELECT MIN(periodo) AS min_periodo, MAX(periodo) AS max_periodo
    FROM raw.castigos_observacion
  `);

  const entidades: EntidadItem[] = rows.map(r => ({
    nombre: String(r.entidad),
    tipo:   String(r.tipo_entidad),
  }));

  const rango       = rangoRows[0];
  const minPeriodo  = rango ? Number(rango.min_periodo) : 202501;
  const maxPeriodo  = rango ? Number(rango.max_periodo) : 202609;

  return (
    <ReporteCastigosClient
      entidades={entidades}
      minPeriodo={minPeriodo}
      maxPeriodo={maxPeriodo}
    />
  );
}
