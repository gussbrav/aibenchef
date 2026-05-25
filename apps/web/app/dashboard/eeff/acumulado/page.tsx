import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { AcumuladoClient } from "./acumulado-client";

export const metadata: Metadata = { title: "Estado de Resultados Acumulado" };
export const dynamic = "force-dynamic";

export default async function AcumuladoPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return <AcumuladoClient />;
}
