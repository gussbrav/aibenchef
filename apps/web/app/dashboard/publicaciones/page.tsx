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
  listPeriodosDisponibles,
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

  const [publicaciones, entidadesDisponibles, ultimoPeriodo, periodos, cliente, defaultPeerGroup] =
    await Promise.all([
      listPublicaciones({ createdBy: `user:${session.user.email}` }),
      listEntidadesDisponibles({}),
      getUltimoPeriodoPublicable(),
      listPeriodosDisponibles({ ultimosN: 120 }),
      clienteSlug ? getClienteBySlug(clienteSlug).catch(() => null) : Promise.resolve(null),
      clienteSlug ? getDefaultPeerGroup(clienteSlug).catch(() => []) : Promise.resolve([]),
    ]);

  // Formatear periodos disponibles con label "Mes AAAA" para el selector.
  const MESES_LABEL = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const periodosDisponibles = periodos.map((p) => {
    const anio = Math.floor(p / 100);
    const mes = p % 100;
    return { codigo: p, label: `${MESES_LABEL[mes - 1] ?? "?"} ${anio}` };
  });

  // Default fijo: Banco de Crédito del Perú (BCP). Reportado 2026-08-11
  // por el user. Antes tomaba el default del cliente (ej. Caja Arequipa
  // -> CMAC Arequipa) pero eso confundia cuando el analista queria
  // arrancar sobre BCP como benchmark de mercado. El user sigue pudiendo
  // cambiarla desde el dropdown "Tu entidad" — solo cambia el DEFAULT.
  // Referencia a cliente.entidadPropia queda como fallback si BCP no
  // esta en la lista de entidades disponibles (edge case improbable).
  void cliente;
  const defaultEntidadPropia = "Banco de Crédito del Perú";
  // Peer group default = VACIO. El user elige explicitamente con quien
  // comparar (o genera un articulo mono-entidad sin comparativa).
  // Reportado 2026-08-11: los defaults imponian entidades que confundian.
  // La variable defaultPeerGroup del server queda solo como hint para
  // el UI ("sugerencia: podrias comparar con X, Y, Z") — futura mejora.
  void defaultPeerGroup; // evita unused
  const defaultPeerGroupSinPropia: string[] = [];

  return (
    <PublicacionesClient
      publicaciones={publicaciones}
      entidadesDisponibles={entidadesDisponibles}
      clientesActivos={clientesActivos}
      periodosDisponibles={periodosDisponibles}
      defaultClienteSlug={clienteSlug}
      defaultEntidadPropia={defaultEntidadPropia}
      defaultPeerGroup={defaultPeerGroupSinPropia}
      defaultPeriodo={ultimoPeriodo ?? 202606}
      userEmail={session.user.email}
    />
  );
}
