import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Container } from "@/components/ui";
import { DashboardUserMenu } from "./user-menu";
import { NavLink } from "./nav-link";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/85 border-b border-slate-200">
        <Container size="xl">
          <div className="flex h-16 items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-sm">
                A
              </div>
              <span className="font-bold text-slate-900">Aibenchef</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8 text-sm">
              <NavLink href="/dashboard" label="Resumen" exact />
              <NavLink href="/dashboard/eeff" label="Estados Financieros" />
              <NavLink href="/dashboard/tableros" label="Tableros" />
              <NavLink href="/dashboard/analisis" label="Analisis Dinamico" />
              <NavLink href="/dashboard/sql" label="SQL Workbench" />
              <NavLink href="/dashboard/catalog" label="Catalog" />
              <NavLink href="/dashboard/admin/archivos" label="Archivos SBS" />
            </nav>

            <DashboardUserMenu name={session.user.name} email={session.user.email} />
          </div>
        </Container>
      </header>

      <main className="py-6">
        {/* Layout full-width. Las paginas narrow (Resumen, EEFF) se envuelven
            internamente en <Container size="xl">. Las paginas tool (analisis,
            sql, catalog) usan todo el ancho. */}
        <Container size="full">{children}</Container>
      </main>
    </div>
  );
}
