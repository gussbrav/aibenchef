import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Database } from "lucide-react";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { Container, PageHero } from "@/components/ui";
import { EntityProfilesClient } from "./entity-profiles-client";

export const metadata: Metadata = {
  title: "Perfiles de entidad",
};

export const dynamic = "force-dynamic";

export default async function EntityProfilesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");

  return (
    <Container size="xl" className="space-y-6">
      <PageHero
        icon={Database}
        iconBg="from-indigo-500 to-blue-700"
        title="Perfiles de entidad"
        tagline="Fichas de contexto de cada entidad financiera / COOPAC que enriquecen los análisis de IA"
        description="Los perfiles se generan automáticamente vía Claude + web_search cuando se analiza una entidad por primera vez. Los que están marcados como 'preliminar' son investigación automática no verificada; los 'validados' fueron revisados y aprobados manualmente."
      />
      <EntityProfilesClient />
    </Container>
  );
}
