import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LayoutDashboard, Activity, BarChart3, Layers } from "lucide-react";

import { auth } from "@/lib/auth";
import { Card, FeatureTile, PageHero } from "@/components/ui";
import { listTableros } from "@/lib/domains/tableros";

import { NewTableroButton } from "./new-tablero-button";
import { DeleteTableroButton } from "./delete-tablero-button";

export const metadata: Metadata = { title: "Tableros" };
export const dynamic = "force-dynamic";

export default async function TablerosPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const tableros = await listTableros(session.user.id);

  return (
    <div className="space-y-6">
      <PageHero
        icon={LayoutDashboard}
        iconBg="from-blue-500 to-cyan-600"
        title="Tableros ejecutivos"
        tagline="Dashboards profesionales que presentás directo al directorio — sin Power BI, sin Excel, sin armar todo de cero cada mes"
        description="Combiná KPIs, gráficos de tendencia y tablas comparativas en un layout drag-and-drop. Cada tablero se actualiza automáticamente con la última data SBS."
        stats={
          tableros.length > 0
            ? [
                { label: "Tableros creados", value: tableros.length },
                {
                  label: "Última edición",
                  value: new Date(
                    Math.max(...tableros.map((t) => new Date(t.updatedAt).getTime())),
                  ).toLocaleDateString("es-PE"),
                },
              ]
            : undefined
        }
        action={<NewTableroButton />}
      />

      {tableros.length === 0 ? (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <FeatureTile
              icon={Activity}
              title="KPIs en vivo"
              description="ROA, ROE, mora, eficiencia. Cualquier ratio anualizado del sistema, en cards grandes con semáforos."
              color="text-emerald-600"
            />
            <FeatureTile
              icon={BarChart3}
              title="Gráficos comparativos"
              description="Tu entidad vs tus pares, en barras, líneas o área. Cambias de periodo y se redibujan."
              color="text-blue-600"
            />
            <FeatureTile
              icon={Layers}
              title="Layout drag-and-drop"
              description="Arrastrá widgets para armar tu vista. Cada tablero queda guardado y compartible."
              color="text-violet-600"
            />
          </div>
          <Card variant="elevated" className="p-12 text-center">
            <LayoutDashboard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-4">
              Creá tu primer tablero en 30 segundos. Empezás con uno en blanco y agregás widgets.
            </p>
            <NewTableroButton variant="cta" />
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tableros.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/tableros/${t.id}` as never}
              className="block group relative"
            >
              <DeleteTableroButton id={t.id} nombre={t.nombre} />
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
