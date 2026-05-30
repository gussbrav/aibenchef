"use client";

import { useMemo, useState } from "react";
import type { MatrizCelda } from "@/lib/domains/admin";

const MES_LABEL = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const TOPICO_LABEL: Record<string, string> = {
  eeff: "Estados Financieros",
  oficinas: "Número de Oficinas",
  personal: "Número de Personal",
  clientes_credito: "Número de Clientes (Crédito)",
  clientes_ahorro: "Número de Clientes (Ahorro)",
  colocaciones: "Créditos Directos por Tipo",
  depositos: "Depósitos por Tipo y Persona",
  castigos: "Flujo de Castigos",
  creditos_depositos_geo: "Créditos y Depósitos por Oficina",
  indicadores: "Indicadores Prudenciales",
};

// Orden y labels oficiales SBS — sincronizado con shared/grupos.ts
import { labelGrupo, ORDEN_GRUPOS_DB } from "@/lib/domains/shared/grupos";

export function MatrizArchivos({ celdas }: { celdas: MatrizCelda[] }) {
  const [grupoExpand, setGrupoExpand] = useState<string | null>(null);

  // Agrupar: grupo -> topico -> anio -> Map<mes, celda>
  const tree = useMemo(() => {
    const t = new Map<string, Map<string, Map<number, Map<number, MatrizCelda>>>>();
    for (const c of celdas) {
      if (!t.has(c.grupo)) t.set(c.grupo, new Map());
      const g = t.get(c.grupo)!;
      if (!g.has(c.topico)) g.set(c.topico, new Map());
      const tp = g.get(c.topico)!;
      if (!tp.has(c.anio)) tp.set(c.anio, new Map());
      tp.get(c.anio)!.set(c.mes, c);
    }
    return t;
  }, [celdas]);

  const gruposOrdenados = ORDEN_GRUPOS_DB.filter((g) => tree.has(g));

  return (
    <div className="space-y-6">
      {gruposOrdenados.map((grupo) => {
        const topicos = tree.get(grupo)!;
        const isOpen = grupoExpand === grupo;
        const totalArchivos = Array.from(topicos.values())
          .flatMap((tp) => Array.from(tp.values()))
          .flatMap((anio) => Array.from(anio.values()))
          .reduce((sum, c) => sum + c.archivos, 0);
        return (
          <div key={grupo} className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setGrupoExpand(isOpen ? null : grupo)}
              className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-slate-900">
                  {labelGrupo(grupo)}
                </span>
                <span className="text-xs text-slate-500">
                  {topicos.size} tópicos · {totalArchivos.toLocaleString()} archivos
                </span>
              </div>
              <svg
                className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
                viewBox="0 0 20 20" fill="currentColor"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>

            {isOpen && (
              <div className="p-4 space-y-5 bg-white">
                {Array.from(topicos.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([topico, porAnio]) => {
                  const aniosSorted = Array.from(porAnio.keys()).sort((a, b) => b - a);
                  return (
                    <div key={topico} className="space-y-2">
                      <h3 className="text-sm font-medium text-slate-700">
                        {TOPICO_LABEL[topico] ?? topico}
                        <span className="ml-2 text-xs text-slate-400">({topico})</span>
                      </h3>
                      <div className="space-y-1.5">
                        {aniosSorted.map((anio) => {
                          const meses = porAnio.get(anio)!;
                          return (
                            <div key={anio} className="flex items-center gap-2">
                              <span className="text-xs font-mono text-slate-500 w-12">{anio}</span>
                              <div className="flex gap-1">
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
                                  const c = meses.get(mes);
                                  return (
                                    <CeldaArchivo key={mes} mes={mes} celda={c} />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CeldaArchivo({ mes, celda }: { mes: number; celda: MatrizCelda | undefined }) {
  if (!celda) {
    return (
      <div
        className="w-10 h-7 flex items-center justify-center text-[10px] text-slate-300 border border-dashed border-slate-200 rounded"
        title={`${MES_LABEL[mes - 1]}: sin archivo`}
      >
        {MES_LABEL[mes - 1]}
      </div>
    );
  }
  const colorByStatus: Record<string, string> = {
    descargado: "bg-sky-100 text-sky-800 border-sky-300",
    procesando: "bg-amber-100 text-amber-800 border-amber-300",
    procesado: "bg-emerald-100 text-emerald-800 border-emerald-300",
    error: "bg-rose-100 text-rose-800 border-rose-300",
    omitido: "bg-slate-100 text-slate-600 border-slate-300",
    no_publicado_sbs: "bg-slate-50 text-slate-400 border-slate-200 italic",
  };
  const labelByStatus: Record<string, string> = {
    no_publicado_sbs: "SBS no publico este periodo",
    descargado: "Descargado (pendiente de procesar)",
    procesando: "Procesando",
    procesado: "Procesado",
    error: "Error en ingesta",
    omitido: "Omitido",
  };
  const status = celda.status ?? "descargado";
  const color = colorByStatus[status] ?? "bg-slate-100 text-slate-700 border-slate-300";
  const tooltip = [
    MES_LABEL[mes - 1] + " " + celda.anio,
    labelByStatus[status] ?? `Status: ${status}`,
    celda.archivos > 1 ? `${celda.archivos} archivos` : null,
    celda.descargadoEn ? `Descargado: ${celda.descargadoEn}` : null,
    celda.filasInsertadas != null ? `${celda.filasInsertadas.toLocaleString()} filas` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div
      className={`w-10 h-7 flex items-center justify-center text-[10px] font-medium border rounded ${color}`}
      title={tooltip}
    >
      {MES_LABEL[mes - 1]}
    </div>
  );
}
