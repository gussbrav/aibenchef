/**
 * Inspector de tópicos — landing genérico que lista los 10 tópicos SBS
 * con métricas agregadas (cobertura, filas raw, errores). Cada card
 * linkea a la vista detalle por tópico.
 */

import Link from "next/link";
import type { Route } from "next";
import {
  getTopicoResumen,
  getUltimoPeriodoConData,
  listTopicos,
} from "@/lib/domains/pipeline/inspector-topicos";

export const dynamic = "force-dynamic";

export default async function InspectorTopicosPage() {
  const topicos = listTopicos();
  // Para cada topico mostramos UNA card con el "ultimo periodo CON data real"
  // (no necesariamente el ultimo descargado, que puede tener 0 filas porque
  // todavia no se proceso). Asi el card muestra info util en vez de ceros.
  const resumenes = await Promise.all(
    topicos.map(async (t) => {
      const ultimoConData = await getUltimoPeriodoConData(t.topico);
      const resumen = await getTopicoResumen(t.topico, 24);
      const rowConData = ultimoConData
        ? resumen.find((r) => r.periodo === ultimoConData)
        : undefined;
      // Fallback: si nunca tuvo data raw, usar el ultimo descargado (rowConData será undefined)
      const display = rowConData ?? resumen[0];
      return { info: t, display, ultimoConData };
    }),
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Inspector de Tópicos</h1>
      <p className="text-sm text-slate-600 mb-6">
        Vista genérica de cada tabla raw SBS. Cobertura agregada del último periodo
        importado y acceso al detalle por entidad / periodo.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {resumenes.map(({ info, display, ultimoConData }) => {
          const cobertura = display
            ? Math.round((display.procesados / Math.max(display.archivos, 1)) * 100)
            : 0;
          const semaforo =
            !display || display.errores > 0
              ? "bg-red-50 border-red-200 text-red-900"
              : cobertura === 100
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-amber-50 border-amber-200 text-amber-900";

          return (
            <Link
              key={info.topico}
              href={`/dashboard/admin/inspector-topicos/${info.topico}` as Route}
              className="block rounded-lg border-2 bg-white hover:shadow-md transition-shadow overflow-hidden"
            >
              <div className={`px-4 py-3 border-b ${semaforo}`}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-semibold text-base capitalize">
                    {info.topico.replace(/_/g, " ")}
                  </h2>
                  {display && (
                    <span className="text-xs font-mono opacity-75">
                      {display.periodo}
                      {ultimoConData && display.periodo !== ultimoConData ? (
                        <span className="text-amber-700"> (sin proc.)</span>
                      ) : null}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4 text-xs space-y-1.5 text-slate-700">
                {display ? (
                  <>
                    <div className="flex justify-between">
                      <span>Archivos</span>
                      <span className="font-mono">{display.archivos}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Procesados</span>
                      <span className="font-mono">{display.procesados}</span>
                    </div>
                    {display.errores > 0 && (
                      <div className="flex justify-between text-red-700 font-semibold">
                        <span>Errores</span>
                        <span className="font-mono">{display.errores}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-2">
                      <span className="text-slate-500">Filas raw</span>
                      <span className="font-mono font-semibold">
                        {display.filasRaw.toLocaleString()}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 italic">Sin data</div>
                )}
                <div className="text-[10px] text-slate-400 mt-2 font-mono">
                  {info.tablaRaw}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 mt-6">
        Las cards muestran el último periodo con data raw real. Si el último
        archivo descargado todavía no fue procesado, aparece la nota{" "}
        <span className="text-amber-700">(sin proc.)</span>. Click para drill-down
        por entidad / periodo / archivo SBS.
      </p>
    </div>
  );
}
