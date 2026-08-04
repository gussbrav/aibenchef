import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NotebookText, FileText, Database, Share2 } from "lucide-react";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { Card, FeatureTile, PageHero } from "@/components/ui";
import { listNotebooks } from "@/lib/domains/notebooks";

import { NewNotebookButton } from "./new-notebook-button";
import { DeleteNotebookButton } from "./delete-notebook-button";

export const metadata: Metadata = { title: "Notebooks" };
export const dynamic = "force-dynamic";

export default async function NotebooksPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");
  const notebooks = await listNotebooks(session.user.id);

  return (
    <div className="space-y-6">
      <PageHero
        icon={NotebookText}
        iconBg="from-amber-500 to-orange-600"
        title="Notebooks"
        tagline="Construí reportes vivos que se ven como un documento pero funcionan como una herramienta — texto explicativo, consultas y visualizaciones en una sola hoja compartible"
        description="Ideal para análisis recurrentes (informes mensuales, presentaciones a clientes, deep-dives) que quieres re-correr con un solo click cuando entran datos nuevos."
        stats={
          notebooks.length > 0
            ? [
                { label: "Notebooks creados", value: notebooks.length },
                {
                  label: "Última edición",
                  value: new Date(
                    Math.max(...notebooks.map((n) => new Date(n.updatedAt).getTime())),
                  ).toLocaleDateString("es-PE"),
                },
              ]
            : undefined
        }
        action={<NewNotebookButton />}
      />

      {notebooks.length === 0 ? (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <FeatureTile
              icon={FileText}
              title="Texto + datos juntos"
              description="Markdown para explicar contexto + celdas SQL para traer datos + charts automáticos. Como un Jupyter o Notion DB."
              color="text-amber-600"
            />
            <FeatureTile
              icon={Database}
              title="Conectado a SBS real"
              description="Cada celda SQL apunta al data warehouse. Cuando entra el cierre mensual, refresh y todo se actualiza."
              color="text-blue-600"
            />
            <FeatureTile
              icon={Share2}
              title="Compartible y reproducible"
              description="Compartí el link interno con tu equipo. Mismo notebook, misma data, mismas conclusiones."
              color="text-emerald-600"
            />
          </div>
          <Card variant="elevated" className="p-12 text-center">
            <NotebookText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-4">
              Creá tu primer notebook — partís de un template o empezás en blanco.
            </p>
            <NewNotebookButton variant="cta" />
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {notebooks.map((n) => (
            <Link
              key={n.id}
              href={`/dashboard/notebooks/${n.id}` as never}
              className="block group relative"
            >
              <DeleteNotebookButton id={n.id} titulo={n.titulo} />
              <Card variant="elevated" className="p-5 hover:shadow-md hover:border-brand-300 transition cursor-pointer h-full">
                <div className="flex items-start justify-between mb-3">
                  <NotebookText className="w-5 h-5 text-brand-600" />
                  <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-mono">
                    {n.nCells} cell{n.nCells === 1 ? "" : "s"}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 mb-1 truncate">{n.titulo}</h3>
                {n.descripcion && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3">{n.descripcion}</p>
                )}
                <div className="text-[10px] text-slate-400">
                  {new Date(n.updatedAt).toLocaleDateString("es-PE")}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
