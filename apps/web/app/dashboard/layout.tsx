import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Container } from "@/components/ui";
import { CommandPalette, CommandPaletteTrigger } from "./command-palette";
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

  // Gate por status: usuarios suspendidos no pueden entrar
  const { getUser } = await import("@/lib/domains/users");
  try {
    const user = await getUser(session.user.id);
    if (user.status === "suspended") {
      redirect("/login?suspended=1");
    }
  } catch {
    // si falla la query no bloqueamos — fail-open para no romper UX
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/85 border-b border-slate-200">
        <Container size="full">
          <div className="flex h-14 items-center justify-between gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
                A
              </div>
              <span className="font-bold text-slate-900 text-sm">Aibenchef</span>
            </Link>

            <nav className="hidden md:flex items-center gap-5 lg:gap-6 text-[13px] flex-1 justify-center min-w-0 whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <NavLink href="/dashboard" label="Resumen" exact />
              <NavLink href="/dashboard/eeff" label="Estados Financieros" />
              <NavLink href="/dashboard/tableros" label="Tableros" />
              <NavLink href="/dashboard/analisis" label="Analisis" />
              <NavLink href="/dashboard/notebooks" label="Notebooks" />
              <NavLink href="/dashboard/sheets" label="Sheets" />
              <NavLink href="/dashboard/genie" label="Genie ✨" />
              <NavLink href="/dashboard/sql" label="SQL" />
              <NavLink href="/dashboard/catalog" label="Catalog" />
              <NavLink href="/dashboard/admin/archivos" label="Archivos" />
            </nav>

            <div className="flex items-center gap-2 flex-shrink-0">
              <CommandPaletteTrigger />
              <DashboardUserMenu name={session.user.name} email={session.user.email} />
            </div>
          </div>
        </Container>
      </header>

      <main className="py-6">
        {/* Layout full-width. Las paginas narrow (Resumen, EEFF) se envuelven
            internamente en <Container size="xl">. Las paginas tool (analisis,
            sql, catalog) usan todo el ancho. */}
        <Container size="full">{children}</Container>
      </main>

      {/* Command Palette global — atajo Cmd+K / Ctrl+K */}
      <CommandPalette />
    </div>
  );
}
