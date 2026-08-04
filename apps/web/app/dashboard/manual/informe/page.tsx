import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { ManualInformeClient } from "./manual-client";

export const metadata: Metadata = {
  title: "Manual del usuario — Informe Benchmark",
  description: "Guia paso a paso para navegar el informe de benchmark competitivo.",
};

export const dynamic = "force-dynamic";

export default async function ManualInformePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return <ManualInformeClient />;
}
