import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import { Container, PageHero } from "@/components/ui";
import { getUserStats } from "@/lib/domains/users";

import { SuscripcionesClient } from "./suscripciones-client";

export const metadata: Metadata = {
  title: "Suscripciones",
};

export const dynamic = "force-dynamic";

/**
 * Panel de suscripciones — vista business-first para gestionar planes,
 * expiraciones, MRR y churn. Complementa a /dashboard/settings > Usuarios
 * (que es la vista identity-first para roles/status/reset password).
 *
 * Este panel:
 *   - Tarjetas de metricas (total, MRR, activos, expiraciones proximas)
 *   - Tabla con filtros server-side (plan, role, status, search, actividad)
 *   - Modal para cambiar plan + expiracion + notas
 *   - Todas las acciones quedan en gov.audit_log (via API PATCH)
 *
 * Gate: heredado de admin/layout.tsx (requiere isAdmin).
 */
export default async function SuscripcionesPage() {
  const initialStats = await getUserStats();

  return (
    <Container size="xl" className="space-y-6 pb-12">
      <PageHero
        icon={CreditCard}
        iconBg="from-emerald-500 to-teal-600"
        title="Suscripciones"
        tagline="Gestioná planes, expiraciones y actividad de todos los suscriptores en un solo lugar"
        description="En fase manual todos los upgrades a Academic/Pro/Business pasan por aquí. Cada cambio queda auditado (quién, cuándo, motivo) y actualiza el enforcement de features en tiempo real. Cuando integres Culqi/Stripe este panel seguirá siendo el override manual + fuente de verdad de MRR."
      />
      <SuscripcionesClient initialStats={initialStats} />
    </Container>
  );
}
