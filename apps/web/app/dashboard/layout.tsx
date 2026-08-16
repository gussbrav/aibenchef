import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession, getUserPlan } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import { Container, ConfirmModalProvider } from "@/components/ui";
import { CommandPalette, CommandPaletteTrigger } from "./command-palette";
import { DashboardUserMenu } from "./user-menu";
import { NavLink } from "./nav-link";
import { NavDropdown } from "./nav-dropdown";
import { TopProgressBar } from "./top-progress-bar";
import { PlanBadge } from "./plan-badge";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  // Gate de menu por rol. Los usuarios no-admin ven solo lo que pueden
  // consumir (Resumen, Benchmark, Estados Financieros, Analisis). Los
  // menus Datos (herramientas power-user: SQL/notebooks/sheets/catalog)
  // y Operaciones (data pipeline + backoffice) quedan ocultos.
  //
  // IMPORTANTE: esto es solo UX. Las paginas admin de cada URL tienen su
  // propio gate isAdmin() + redirect (defensa en profundidad). Modificar
  // el bundle client-side no burla el gate de la pagina.
  const admin = await isAdmin(session.user.id).catch(() => false);
  const plan = await getUserPlan(session.user.id);

  // NOTA: el gate por status='suspended' se movio del layout a /api/me y a
  // los endpoints sensibles. El layout no debe hacer queries adicionales
  // porque cualquier excepcion no-redirect rompe TODAS las rutas del dashboard.

  return (
    <ConfirmModalProvider>
    <div className="min-h-screen bg-slate-50">
      {/* Signature progress bar — se anima en cada navegacion interna */}
      <TopProgressBar />
      <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/85 border-b border-slate-200">
        <Container size="full">
          <div className="flex h-14 items-center justify-between gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
                A
              </div>
              <span className="font-bold text-slate-900 text-sm">Aibenchef</span>
            </Link>

            <nav className="hidden md:flex items-center gap-5 lg:gap-6 text-[13px] flex-1 justify-center min-w-0 whitespace-nowrap">
              <NavLink href="/dashboard" label="Resumen" exact />
              <NavLink href="/dashboard/informe" label="Benchmark" />
              <NavLink href="/dashboard/punto-equilibrio" label="Punto Equilibrio" />
              <NavLink href="/dashboard/dupont" label="DuPont" />

              {/* Menu gating por plan (V167 + V168):
                  - free: solo Resumen + Benchmark + PE + DuPont
                  - academic: agrega EEFF + Análisis (todo excepto Publicaciones)
                  - pro/business: todo incluyendo Publicaciones AI
                  Gate en cada page sigue vigente (defensa en profundidad). */}
              {(admin || plan === "pro" || plan === "business") && (
                <NavLink href="/dashboard/publicaciones" label="Publicaciones" />
              )}

              {(admin || plan !== "free") && (
                <>
                  <NavDropdown
                    label="Estados Financieros"
                    items={[
                      {
                        href: "/dashboard/eeff",
                        label: "EEFF mensuales",
                        description: "Balance General + Estado de Resultados de cualquier entidad y periodo",
                      },
                      {
                        href: "/dashboard/eeff/acumulado",
                        label: "ER Anualizado",
                        description: "Tendencia del Estado de Resultados anualizado (últimos 12 meses móviles)",
                      },
                    ]}
                  />

                  <NavDropdown
                    label="Análisis"
                    items={[
                      {
                        href: "/dashboard/tableros",
                        label: "Tableros ejecutivos",
                        description: "Dashboards personalizados con KPIs, gráficos y tablas para presentar a directorio",
                      },
                      {
                        href: "/dashboard/analisis",
                        label: "Análisis dinámico",
                        description: "Compara entidades, períodos y métricas con tablas pivote sin escribir SQL",
                      },
                      // Aiben ✨ IA: oculto temporalmente. La feature funciona pero
                      // esta pendiente estabilizar la calidad de las respuestas y
                      // definir el scope final antes de re-habilitarlo. Volver a
                      // agregar aca cuando este listo para usuarios finales.
                    ]}
                  />
                </>
              )}

              {admin && (
                <NavDropdown
                  label="Datos"
                  items={[
                    {
                      href: "/dashboard/notebooks",
                      label: "Notebooks",
                      description: "Reportes interactivos: texto + consultas + visualizaciones en una hoja compartible",
                    },
                    {
                      href: "/dashboard/sheets",
                      label: "Sheets",
                      description: "Hojas de cálculo editables con fórmulas, gráficos y datos ad-hoc. Export al formato XLSX.",
                    },
                    {
                      href: "/dashboard/sql",
                      label: "SQL Workbench",
                      description: "Consulta directa a la base de datos analítica con SQL completo (avanzado)",
                    },
                    {
                      href: "/dashboard/catalog",
                      label: "Catálogo de datos",
                      description: "Explora todas las tablas, vistas y modelos disponibles del data warehouse",
                    },
                  ]}
                />
              )}

              {admin && (
                <NavDropdown
                  label="Operaciones"
                  items={[
                    { href: "/dashboard/admin/suscripciones", label: "Suscripciones", description: "MRR, planes, expiraciones y actividad de suscriptores" },
                    { href: "/dashboard/admin/access-requests", label: "Solicitudes de acceso", description: "Triage de leads de la waitlist con aprobación 1-click" },
                    { href: "/dashboard/admin/pipeline", label: "Pipeline", description: "Observabilidad de ingesta desde fuentes oficiales" },
                    { href: "/dashboard/admin/data-quality", label: "Data Quality", description: "Completeness, freshness, cargas sospechosas" },
                    { href: "/dashboard/admin/archivos", label: "Archivos", description: "Archivos descargados desde fuentes oficiales" },
                    { href: "/dashboard/admin/renombres", label: "Maestra", description: "Renombres y entidades" },
                    { href: "/dashboard/admin/eeff-inspector", label: "EEFF Inspector", description: "Validar extracción cuenta-por-cuenta" },
                    { href: "/dashboard/admin/inspector-topicos", label: "Inspector Tópicos", description: "Vista raw oficinas/personal/clientes/etc." },
                    { href: "/dashboard/admin/cabecera-aligner", label: "Aligner", description: "Alinear cabeceras dw" },
                  ]}
                />
              )}
            </nav>

            <div className="flex items-center gap-2 flex-shrink-0">
              <PlanBadge plan={plan} admin={admin} />
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
    </ConfirmModalProvider>
  );
}
