import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CloudRain } from "lucide-react";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { Container, PageHero } from "@/components/ui";
import { MacroContextClient } from "./macro-context-client";

export const metadata: Metadata = {
  title: "Contexto macro vigente",
};

export const dynamic = "force-dynamic";

export default async function MacroContextPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");

  return (
    <Container size="xl" className="space-y-6">
      <PageHero
        icon={CloudRain}
        iconBg="from-sky-500 to-indigo-700"
        title="Contexto macro vigente"
        tagline="Snapshots del entorno macro peruano que alimentan los análisis de IA (Niño, tasas BCR, regulatorio, político, sectorial)"
        description="El contexto se refresca vía Claude + web_search. Puedes dispararlo manual desde aquí o editar/validar cada ítem individualmente. Los ítems con vigencia pasada se marcan automáticamente como expirados tras 7 días."
      />
      <MacroContextClient />
    </Container>
  );
}
