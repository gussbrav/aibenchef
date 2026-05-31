import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Mailbox } from "lucide-react";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { Container, PageHero } from "@/components/ui";
import { AccessRequestsClient } from "./access-requests-client";

export const metadata: Metadata = {
  title: "Solicitudes de acceso",
};

export const dynamic = "force-dynamic";

export default async function AccessRequestsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");

  return (
    <Container size="xl" className="space-y-6">
      <PageHero
        icon={Mailbox}
        iconBg="from-amber-500 to-rose-600"
        title="Solicitudes de acceso"
        tagline="Triage de leads que solicitaron acceso al beta — aprobá con 1 click y se dispara la invitación automáticamente"
        description="Cada solicitud llega de la página pública /solicitar-acceso. Las que apruebes se transforman en una invitación que se envía por email al solicitante. Las que marqués como spam quedan archivadas y no se cuentan en estadísticas."
      />
      <AccessRequestsClient />
    </Container>
  );
}
