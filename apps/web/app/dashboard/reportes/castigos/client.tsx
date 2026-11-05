"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Search, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type EntidadItem = { nombre: string; tipo: string };

const GROUP_ORDER: Record<string, number> = {
  BANCOS: 1, FINANCIERAS: 2, CMAC: 3, CRAC: 4, EDPYMES: 5,
  BANCO_NACION: 6, OTRO: 7,
  COOPAC_N3: 10, COOPAC_N2B: 11, COOPAC_N2A: 12, COOPAC_N1: 13,
};

function getTipoLabel(tipo: string): string {
  const MAP: Record<string, string> = {
    BANCOS: "Bancos", FINANCIERAS: "Financieras", CMAC: "Cajas Municipales (CMAC)",
    CRAC: "Cajas Rurales (CRAC)", EDPYMES: "Edpymes", BANCO_NACION: "Banco de la Nación",
    OTRO: "Otras entidades SF",
    COOPAC_N3: "Cooperativas · Nivel 3", COOPAC_N2B: "Cooperativas · Nivel 2B",
    COOPAC_N2A: "Cooperativas · Nivel 2A", COOPAC_N1: "Cooperativas · Nivel 1",
  };
  return MAP[tipo] ?? tipo;
}

function isTipoCoopac(tipo: string) { return tipo.startsWith("COOPAC_"); }

/** Genera lista de YYYYMM desde min hasta max inclusive */
function buildPeriodOptions(min: number, max: number): number[] {
  const opts: number[] = [];
  let cur = min;
  while (cur <= max) {
    opts.push(cur);
    const year  = Math.floor(cur / 100);
    const month = cur % 100;
    cur = month === 12 ? (year + 1) * 100 + 1 : year * 100 + (month + 1);
  }
  return opts;
}

function periodoLabel(p: number): string {
  const año = Math.floor(p / 100);
  const mes = p % 100;
  const nombres = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Set","Oct","Nov","Dic"];
  return `${nombres[(mes - 1)] ?? "?"} ${año}`;
}

export function ReporteCastigosClient({
  entidades,
  minPeriodo,
  maxPeriodo,
}: {
  entidades: EntidadItem[];
  minPeriodo: number;
  maxPeriodo: number;
}) {
  const allPeriodOptions = useMemo(
    () => buildPeriodOptions(minPeriodo, maxPeriodo),
    [minPeriodo, maxPeriodo],
  );

  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [desde,    setDesde]    = useState(minPeriodo);
  const [hasta,    setHasta]    = useState(maxPeriodo);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entidades.filter(e => e.nombre.toLowerCase().includes(q)) : entidades;
  }, [entidades, search]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, EntidadItem[]>();
    for (const e of filtradas) {
      if (!mapa.has(e.tipo)) mapa.set(e.tipo, []);
      mapa.get(e.tipo)!.push(e);
    }
    return [...mapa.entries()].sort((a, b) => (GROUP_ORDER[a[0]] ?? 99) - (GROUP_ORDER[b[0]] ?? 99));
  }, [filtradas]);

  const desdeOptions = allPeriodOptions;
  const hastaOptions = useMemo(
    () => allPeriodOptions.filter(p => p >= desde),
    [allPeriodOptions, desde],
  );

  const nMeses = useMemo(() => {
    return allPeriodOptions.filter(p => p >= desde && p <= hasta).length;
  }, [allPeriodOptions, desde, hasta]);

  const toggle = (nombre: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(nombre)) s.delete(nombre); else s.add(nombre);
      return s;
    });
  };

  const toggleTipo = (tipo: string) => {
    const ents = grupos.find(g => g[0] === tipo)?.[1] ?? [];
    const allSel = ents.every(e => selected.has(e.nombre));
    setSelected(prev => {
      const s = new Set(prev);
      if (allSel) ents.forEach(e => s.delete(e.nombre));
      else ents.forEach(e => s.add(e.nombre));
      return s;
    });
  };

  const toggleTodos = () => {
    if (filtradas.every(e => selected.has(e.nombre))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtradas.map(e => e.nombre)));
    }
  };

  const descargar = async () => {
    if (selected.size === 0) { setError("Selecciona al menos una entidad."); return; }
    if (desde > hasta) { setError("El período de inicio no puede ser mayor al período final."); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/reportes/castigos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entidades: [...selected], desde, hasta }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `Castigos_SF_${desde}-${hasta}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado al generar el reporte.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reporte Castigos SF</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Exporta castigos mensuales por entidad y línea de producto (Microempresa, Pequeña Empresa,
            Consumo, Hipotecario, Comerciales) a Excel. Diseñado para incluir COOPAC cuando SBS los publique.
          </p>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Panel izquierdo — selector de entidades */}
        <div className="flex-[3] min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">
              Entidades
              {selected.size > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-brand-600 text-white">
                  {selected.size}
                </span>
              )}
            </span>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar entidad…"
                className="w-full h-8 pl-8 pr-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
              />
            </div>

            <button
              type="button"
              onClick={toggleTodos}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium underline-offset-2 hover:underline whitespace-nowrap"
            >
              {filtradas.every(e => selected.has(e.nombre)) && filtradas.length > 0
                ? "Deseleccionar todos"
                : "Seleccionar todos"}
            </button>
          </div>

          <div className="max-h-[560px] overflow-y-auto divide-y divide-slate-100">
            {grupos.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                Sin resultados para <span className="font-mono">&quot;{search}&quot;</span>
              </div>
            ) : (
              grupos.map(([tipo, ents]) => {
                const allSel  = ents.every(e => selected.has(e.nombre));
                const someSel = ents.some(e => selected.has(e.nombre));
                const isCoopac = isTipoCoopac(tipo);

                return (
                  <div key={tipo}>
                    <button
                      type="button"
                      onClick={() => toggleTipo(tipo)}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-2 text-left",
                        isCoopac ? "bg-teal-50/60 hover:bg-teal-50" : "bg-slate-50/80 hover:bg-slate-100/80",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {allSel ? (
                          <CheckSquare className={cn("w-4 h-4 flex-shrink-0", isCoopac ? "text-teal-600" : "text-brand-600")} />
                        ) : someSel ? (
                          <div className={cn("w-4 h-4 flex-shrink-0 rounded border-2 relative", isCoopac ? "border-teal-500" : "border-brand-500")}>
                            <div className={cn("absolute inset-1 rounded-sm", isCoopac ? "bg-teal-500" : "bg-brand-500")} />
                          </div>
                        ) : (
                          <Square className="w-4 h-4 flex-shrink-0 text-slate-300" />
                        )}
                        <span className={cn("text-xs font-semibold uppercase tracking-wider", isCoopac ? "text-teal-700" : "text-slate-500")}>
                          {getTipoLabel(tipo)}
                        </span>
                      </span>
                      <span className={cn("text-xs font-medium", isCoopac ? "text-teal-400" : "text-slate-400")}>
                        {ents.filter(e => selected.has(e.nombre)).length}/{ents.length}
                      </span>
                    </button>

                    {ents.map(ent => {
                      const isSel = selected.has(ent.nombre);
                      return (
                        <button
                          key={ent.nombre}
                          type="button"
                          onClick={() => toggle(ent.nombre)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                            isSel ? "bg-brand-50 hover:bg-brand-100/60" : "hover:bg-slate-50",
                          )}
                        >
                          <div className={cn(
                            "w-4 h-4 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors",
                            isSel ? "bg-brand-600 border-brand-600" : "border-slate-300",
                          )}>
                            {isSel && (
                              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span className={cn("text-sm flex-1 truncate", isSel ? "text-slate-900 font-medium" : "text-slate-700")}>
                            {ent.nombre}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60">
            <p className="text-[11px] text-slate-400">
              {filtradas.length} entidades mostradas · {selected.size} seleccionadas
            </p>
          </div>
        </div>

        {/* Panel derecho — configuración */}
        <div className="lg:w-72 flex-shrink-0 space-y-4">

          {/* Rango de períodos */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Rango de períodos</h2>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Desde</label>
                <select
                  value={desde}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setDesde(v);
                    if (hasta < v) setHasta(v);
                  }}
                  className="w-full h-9 mt-1 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
                >
                  {desdeOptions.map(p => (
                    <option key={p} value={p}>{periodoLabel(p)}</option>
                  ))}
                </select>
              </div>
              <span className="text-slate-300 mt-5">—</span>
              <div className="flex-1">
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Hasta</label>
                <select
                  value={hasta}
                  onChange={e => setHasta(Number(e.target.value))}
                  className="w-full h-9 mt-1 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
                >
                  {hastaOptions.map(p => (
                    <option key={p} value={p}>{periodoLabel(p)}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              {nMeses} mes{nMeses !== 1 ? "es" : ""} en el rango seleccionado
            </p>
          </div>

          {/* Info de columnas */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Columnas por entidad</h2>
            {["Total", "Microempresa", "Pequeña Empresa", "Consumo", "Hipotecario", "Comerciales"].map(p => (
              <div key={p} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />
                <span className="text-xs text-slate-600">{p}</span>
              </div>
            ))}
            <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-200 mt-2">
              Diseñado para incluir COOPAC cuando SBS los publique
            </p>
          </div>

          {/* Resumen + botón */}
          <div className="space-y-2">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-red-700 leading-snug">{error}</span>
              </div>
            )}
            <div className="text-[11px] text-slate-400 text-center">
              {selected.size} entidad{selected.size !== 1 ? "es" : ""} · {nMeses} mes{nMeses !== 1 ? "es" : ""}
            </div>
            <button
              type="button"
              disabled={loading || selected.size === 0}
              onClick={descargar}
              className={cn(
                "w-full h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all",
                loading || selected.size === 0
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-brand-600 hover:bg-brand-700 text-white shadow-sm hover:shadow",
              )}
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                  Generando Excel…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Descargar Excel
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
