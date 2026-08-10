import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth-helpers";
import { listPublicaciones } from "@/lib/domains/publicaciones";
import { getUser } from "@/lib/domains/users";
import { listEntidadesDisponibles, getUltimoPeriodoPublicable } from "@/lib/domains/informe/queries";
import { PublicacionesClient } from "./client";

export const metadata: Metadata = {
  title: "Publicaciones",
  description:
    "Genera articulos long-form estilo editorial para publicar en LinkedIn.",
};

export const dynamic = "force-dynamic";

export default async function PublicacionesPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  // Data del usuario para prefill del wizard
  let defaultClienteSlug: string | null = null;
  try {
    const user = await getUser(session.user.id);
    defaultClienteSlug = user.defaultClienteSlug;
  } catch {
    /* fallback: cliente se pide en el wizard */
  }

  const [publicaciones, entidadesDisponibles, ultimoPeriodo] = await Promise.all([
    listPublicaciones({ createdBy: `user:${session.user.email}` }),
    listEntidadesDisponibles({}),
    getUltimoPeriodoPublicable(),
  ]);

  return (
    <PublicacionesClient
      publicaciones={publicaciones}
      entidadesDisponibles={entidadesDisponibles}
      defaultClienteSlug={defaultClienteSlug}
      defaultPeriodo={ultimoPeriodo ?? 202606}
      userEmail={session.user.email}
    />
  );
}
