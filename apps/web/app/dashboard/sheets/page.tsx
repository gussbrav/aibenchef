import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TableProperties, FileSpreadsheet, Calculator, Download } from "lucide-react";

import { auth } from "@/lib/auth";
import { Card, FeatureTile, PageHero } from "@/components/ui";
import { listSheets } from "@/lib/domains/sheets";

import { NewSheetButton } from "./new-sheet-button";

export const metadata: Metadata = { title: "Sheets" };
export const dynamic = "force-dynamic";

export default async function SheetsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const sheets = await listSheets(session.user.id);

  return (
    <div className="space-y-6">
      <PageHero
        icon={TableProperties}
        iconBg="from-emerald-500 to-teal-600"
        title="Sheets"
        tagline="Hojas de cálculo editables — la familiaridad de Excel adentro de Aibenchef, sin saltar a otra app"
        description="Para cuando necesitás meter datos a mano, hacer cálculos rápidos, o armar un export ad-hoc para mandar por mail. Edición tipo Google Sheets, persistido en la nube."
        stats={
          sheets.length > 0
            ? [
                { label: "Sheets creados", value: sheets.length },
                {
                  label: "Última edición",
                  value: new Date(
                    Math.max(...sheets.map((s) => new Date(s.updatedAt).getTime())),
                  ).toLocaleDateString("es-PE"),
                },
              ]
            : undefined
        }
        action={<NewSheetButton />}
      />

      {sheets.length === 0 ? (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <FeatureTile
              icon={FileSpreadsheet}
              title="Como un Excel online"
              description="Editás celdas, agregás filas, formato básico. Sin instalar nada, accesible desde cualquier dispositivo."
              color="text-emerald-600"
            />
            <FeatureTile
              icon={Calculator}
              title="Cálculos rápidos"
              description="Pegás datos del informe, hacés operaciones manuales, mezclás con texto. Ideal para casos donde SQL es overkill."
              color="text-blue-600"
            />
            <FeatureTile
              icon={Download}
              title="Export XLSX"
              description="Bajás como Excel real para compartir fuera del sistema o entregar a clientes."
              color="text-violet-600"
            />
          </div>
          <Card variant="elevated" className="p-12 text-center">
            <TableProperties className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-4">
              Aún no tenés sheets. Creá una nueva para empezar a editar celdas.
            </p>
            <NewSheetButton variant="cta" />
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sheets.map((s) => (
            <Link key={s.id} href={`/dashboard/sheets/${s.id}` as never} className="block">
              <Card
                variant="elevated"
                className="p-5 hover:shadow-md hover:border-brand-300 transition cursor-pointer h-full"
              >
                <div className="flex items-start justify-between mb-3">
                  <TableProperties className="w-5 h-5 text-emerald-600" />
                  <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-mono">
                    {s.nCells} celdas · {s.nRows}×{s.nCols}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 mb-1 truncate">{s.nombre}</h3>
                {s.descripcion && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3">{s.descripcion}</p>
                )}
                <div className="text-[10px] text-slate-400">
                  {new Date(s.updatedAt).toLocaleDateString("es-PE")}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
