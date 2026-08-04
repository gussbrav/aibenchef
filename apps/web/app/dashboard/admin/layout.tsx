/**
 * Admin layout — gate compartido para todas las paginas bajo /dashboard/admin/*.
 *
 * Antes cada page.tsx repetia el patron (session -> isAdmin -> redirect), y en
 * varias faltaba (archivos, cabecera-aligner, data-quality, diagnostico,
 * eeff-inspector, governance, inspector-topicos, pipeline, renombres). Un
 * usuario no-admin con la URL directa podia entrar. Este layout cierra ese
 * agujero de una: si Next.js resuelve /dashboard/admin/*, PRIMERO pasa por
 * este file. Sin sesion -> /login. Sin rol admin -> /dashboard.
 *
 * IMPORTANTE: esto es defensa en profundidad para las paginas. Las APIs
 * (/api/v1/admin/*) tienen su propio requireAdmin() a nivel handler — no
 * dependen del layout.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");
  return <>{children}</>;
}
