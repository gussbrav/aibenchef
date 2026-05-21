import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Container } from "@/components/ui";
import { DashboardUserMenu } from "./user-menu";

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

            <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600">
              <Link href="/dashboard" className="hover:text-slate-900 transition-colors">
                Resumen
              </Link>
              <Link href="/dashboard/eeff" className="hover:text-slate-900 transition-colors">
                Estados Financieros
              </Link>
            </nav>

            <DashboardUserMenu name={session.user.name} email={session.user.email} />
          </div>
        </Container>
      </header>

      <main className="py-10">
        <Container size="xl">{children}</Container>
      </main>
    </div>
  );
}
