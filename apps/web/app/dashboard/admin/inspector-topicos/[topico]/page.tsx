/**
 * Detalle por tópico — vista de un tópico SBS con:
 *  - Resumen de últimos 24 periodos (archivos, procesados, errores, filas raw)
 *  - Sample lineal de las filas raw filtradas por periodo + entidad
 *
 * Aplica a todos los tópicos del registry (oficinas, personal, clientes, etc.).
 */

import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import {
  TOPICO_REGISTRY,
  getTopicoEntidades,
  getTopicoRawSample,
  getTopicoResumen,
} from "@/lib/domains/pipeline/inspector-topicos";

export const dynamic = "force-dynamic";

type Params = Promise<{ topico: string }>;
type Search = Promise<{ periodo?: string; entidad?: string }>;

export default async function InspectorTopicoDetallePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { topico } = await params;
  const sp = await searchParams;
  const info = TOPICO_REGISTRY[topico];
  if (!info) notFound();

  const resumen = await getTopicoResumen(topico, 24);
  const periodoActual = sp.periodo ? Number(sp.periodo) : resumen[0]?.periodo ?? 0;
  const entidades = await getTopicoEntidades(topico, periodoActual);
  const entidadActual = sp.entidad ?? entidades[0] ?? "";
  const sample = await getTopicoRawSample(topico, {
    periodo: periodoActual,
    entidad: entidadActual || undefined,
    limit: 200,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div>
        <Link href={"/dashboard/admin/inspector-topicos" as Route} className="text-xs text-slate-500 hover:text-slate-700">
          ← Tópicos
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2 capitalize">
          Inspector: {info.topico.replace(/_/g, " ")}
        </h1>
        <p className="text-xs text-slate-500 font-mono">{info.tablaRaw}</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          Últimos {resumen.length} periodos
        </h2>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="text-xs w-full">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="text-left p-2">Periodo</th>
                <th className="text-right p-2">Archivos</th>
                <th className="text-right p-2">Procesados</th>
                <th className="text-right p-2">Errores</th>
                <th className="text-right p-2">Filas raw</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => {
                const esActual = r.periodo === periodoActual;
                return (
                  <tr
                    key={r.periodo}
                    className={`border-t ${esActual ? "bg-amber-50 font-semibold" : "hover:bg-slate-50"}`}
                  >
                    <td className="p-2">
                      <Link
                        href={`/dashboard/admin/inspector-topicos/${topico}?periodo=${r.periodo}` as Route}
                        className="text-sky-700 hover:underline font-mono"
                      >
                        {r.periodo}
                      </Link>
                    </td>
                    <td className="p-2 text-right font-mono">{r.archivos}</td>
                    <td className="p-2 text-right font-mono">{r.procesados}</td>
                    <td className={`p-2 text-right font-mono ${r.errores > 0 ? "text-red-700" : ""}`}>
                      {r.errores}
                    </td>
                    <td className="p-2 text-right font-mono">{r.filasRaw.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {entidades.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Sample raw — periodo {periodoActual}
          </h2>
          <div className="flex items-center gap-3 mb-3">
            <label className="text-xs text-slate-600">Entidad:</label>
            <form className="flex gap-2 flex-wrap">
              <input type="hidden" name="periodo" value={periodoActual} />
              <select
                name="entidad"
                defaultValue={entidadActual}
                className="border border-slate-300 rounded px-2 py-1 text-xs bg-white min-w-[280px]"
              >
                {entidades.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1 text-xs bg-slate-900 text-white rounded hover:bg-slate-700"
              >
                Filtrar
              </button>
            </form>
            <span className="text-xs text-slate-500 ml-auto">
              {sample.filas.length} filas (max 200)
            </span>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="text-[11px] w-full">
              <thead className="bg-slate-100 text-slate-700 sticky top-0">
                <tr>
                  {sample.columnas.map((c) => (
                    <th key={c} className="text-left p-1.5 font-semibold whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.filas.map((row, idx) => (
                  <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                    {sample.columnas.map((c) => {
                      const v = row[c];
                      const display =
                        v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                      const isNum = typeof v === "number" || (typeof v === "string" && /^-?\d/.test(v));
                      return (
                        <td
                          key={c}
                          className={`p-1.5 whitespace-nowrap ${isNum ? "text-right font-mono" : ""}`}
                        >
                          {display.length > 80 ? display.slice(0, 80) + "…" : display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
