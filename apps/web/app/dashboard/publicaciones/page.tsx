import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth-helpers";
import { listPublicaciones } from "@/lib/domains/publicaciones";
import { getUser } from "@/lib/domains/users";
import {
  getClienteBySlug,
  listEntidadesDisponibles,
  getUltimoPeriodoPublicable,
} from "@/lib/domains/informe/queries";
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

  // Data del usuario para prefill del wizard — resolver el cliente por
  // defecto + su entidad canonica asi el user no arranca con "Alfin Banco"
  // (primera alfabetica) sino con SU entidad.
  let defaultClienteSlug: string | null = null;
  try {
    const user = await getUser(session.user.id);
    defaultClienteSlug = user.defaultClienteSlug;
  } catch {
    /* fallback: cliente se pide en el wizard */
  }
  const clienteSlug = defaultClienteSlug ?? "bcp";

  const [publicaciones, entidadesDisponibles, ultimoPeriodo, cliente] =
    await Promise.all([
      listPublicaciones({ createdBy: `user:${session.user.email}` }),
      listEntidadesDisponibles({}),
      getUltimoPeriodoPublicable(),
      getClienteBySlug(clienteSlug).catch(() => null),
    ]);

  const defaultEntidadPropia =
    cliente?.entidadPropia ?? "Banco de Crédito del Perú";

  return (
    <PublicacionesClient
      publicaciones={publicaciones}
      entidadesDisponibles={entidadesDisponibles}
      defaultClienteSlug={clienteSlug}
      defaultEntidadPropia={defaultEntidadPropia}
      defaultPeriodo={ultimoPeriodo ?? 202606}
      userEmail={session.user.email}
    />
  );
}
