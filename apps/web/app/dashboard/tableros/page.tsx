import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LayoutDashboard, Plus } from "lucide-react";

import { auth } from "@/lib/auth";
import { Card } from "@/components/ui";
import { listTableros } from "@/lib/domains/tableros";

import { NewTableroButton } from "./new-tablero-button";

export const metadata: Metadata = { title: "Tableros" };
export const dynamic = "force-dynamic";

export default async function TablerosPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const tableros = await listTableros(session.user.id);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Tableros</h1>
          <p className="text-sm text-slate-600">
            Dashboards multi-widget combinando KPIs, charts y tablas. Estilo Power BI.
          </p>
        </div>
        <NewTableroButton />
      </header>

      {tableros.length === 0 ? (
        <Card variant="elevated" className="p-12 text-center">
          <LayoutDashboard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-4">
            Aun no creaste ningun tablero. Empezar con uno en blanco:
          </p>
          <NewTableroButton variant="cta" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tableros.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/tableros/${t.id}` as never}
              className="block"
            >
              <Card
                variant="elevated"
                className="p-5 hover:shadow-md hover:border-brand-300 transition cursor-pointer h-full"
              >
                <div className="flex items-start justify-between mb-3">
                  <LayoutDashboard className="w-5 h-5 text-brand-600" />
                  <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-mono">
                    {t.widgetsCount} widget{t.widgetsCount === 1 ? "" : "s"}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 mb-1 truncate">{t.nombre}</h3>
                {t.descripcion && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3">{t.descripcion}</p>
                )}
                <div className="text-[10px] text-slate-400">
                  Actualizado {new Date(t.updatedAt).toLocaleDateString("es-PE")}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
