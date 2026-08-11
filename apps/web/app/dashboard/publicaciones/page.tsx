import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth-helpers";
import { listPublicaciones } from "@/lib/domains/publicaciones";
import { getUser } from "@/lib/domains/users";
import {
  getClienteBySlug,
  getDefaultPeerGroup,
  listClientesActivos,
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
  //
  // Fix 2026-08-10: antes teniamos fallback hardcoded "bcp" que fallaba con
  // FK cuando el slug no existia en config.cliente. Ahora leemos la lista
  // real de clientes activos y usamos el primero como fallback.
  let defaultClienteSlug: string | null = null;
  try {
    const user = await getUser(session.user.id);
    defaultClienteSlug = user.defaultClienteSlug;
  } catch {
    /* fallback: cliente se pide en el wizard */
  }

  const clientesActivos = await listClientesActivos();
  const clienteSlug =
    defaultClienteSlug && clientesActivos.some((c) => c.slug === defaultClienteSlug)
      ? defaultClienteSlug
      : (clientesActivos[0]?.slug ?? "");

  const [publicaciones, entidadesDisponibles, ultimoPeriodo, cliente, defaultPeerGroup] =
    await Promise.all([
      listPublicaciones({ createdBy: `user:${session.user.email}` }),
      listEntidadesDisponibles({}),
      getUltimoPeriodoPublicable(),
      clienteSlug ? getClienteBySlug(clienteSlug).catch(() => null) : Promise.resolve(null),
      clienteSlug ? getDefaultPeerGroup(clienteSlug).catch(() => []) : Promise.resolve([]),
    ]);

  const defaultEntidadPropia =
    cliente?.entidadPropia ?? "Banco de Crédito del Perú";
  // Grupo comparable = peer group del cliente MENOS la entidad propia
  // (ya la mostramos aparte como "tu entidad") — asi el user ve solo los
  // competidores a comparar.
  const defaultPeerGroupSinPropia = defaultPeerGroup.filter(
    (n) => n !== defaultEntidadPropia,
  );

  return (
    <PublicacionesClient
      publicaciones={publicaciones}
      entidadesDisponibles={entidadesDisponibles}
      clientesActivos={clientesActivos}
      defaultClienteSlug={clienteSlug}
      defaultEntidadPropia={defaultEntidadPropia}
      defaultPeerGroup={defaultPeerGroupSinPropia}
      defaultPeriodo={ultimoPeriodo ?? 202606}
      userEmail={session.user.email}
    />
  );
}
