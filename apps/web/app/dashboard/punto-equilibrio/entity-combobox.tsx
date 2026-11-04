"use client";

/**
 * EntityCombobox — selector de entidad con search, keyboard nav y look
 * premium tipo Linear/Vercel/Notion.
 *
 * Layout en modo lista (sin busqueda):
 *   - Secciones: "Sistema Financiero" / "Cooperativas · N3" / "Cooperativas · N2B" / ...
 *   - Sin badge por item — el nivel ya esta en el header de seccion.
 *   - Ancho del popover independiente del trigger (min 540px).
 *
 * Layout en modo busqueda (texto en el input):
 *   - Lista plana sin secciones, con badge de nivel para distinguir SF vs COOPAC.
 *
 * Trigger button:
 *   - Muestra badge [N3] / [N2B] / ... cuando hay una cooperativa seleccionada.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EntidadFreshnessBadge } from "@/components/ui";
import { computeMaxUltimoPeriodo } from "@/lib/utils/periodo-freshness";

export type EntityOption = {
  nombCorreg: string;
  primerPeriodo?: number;
  ultimoPeriodo?: number;
  tipoEntidad?: string | null;
};

// Orden de grupos para la lista (SF primero, luego COOPAC de mayor a menor)
const GROUP_ORDER: Record<string, number> = {
  BANCOS: 1, FINANCIERAS: 2, CMAC: 3, CRAC: 4, EDPYMES: 5,
  BANCO_NACION: 6, OTRO: 7,
  COOPAC_N3: 10, COOPAC_N2B: 11, COOPAC_N2A: 12, COOPAC_N1: 13,
};

function getSectionKey(tipoEntidad: string | null | undefined): string {
  if (!tipoEntidad || !tipoEntidad.startsWith("COOPAC_")) return "__SF__";
  return tipoEntidad;
}

function getSectionLabel(key: string): string {
  if (key === "__SF__") return "Sistema Financiero";
  if (key === "COOPAC_N3")  return "Cooperativas · N3";
  if (key === "COOPAC_N2B") return "Cooperativas · N2B";
  if (key === "COOPAC_N2A") return "Cooperativas · N2A";
  if (key === "COOPAC_N1")  return "Cooperativas · N1";
  return key;
}

export function EntityCombobox({
  value,
  options,
  onChange,
  label,
  placeholder = "Buscar entidad…",
  className,
}: {
  value: string;
  options: EntityOption[];
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isSearching = search.trim() !== "";

  // Lista filtrada y ordenada:
  //   - Sin busqueda: ordena por grupo (SF → N3 → N2B → N2A → N1), luego nombre.
  //   - Con busqueda: plana, sin reordenar (relevancia de match importa mas que grupo).
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? options.filter((o) => o.nombCorreg.toLowerCase().includes(q))
      : [...options].sort((a, b) => {
          const ga = GROUP_ORDER[a.tipoEntidad ?? ""] ?? 8;
          const gb = GROUP_ORDER[b.tipoEntidad ?? ""] ?? 8;
          if (ga !== gb) return ga - gb;
          return a.nombCorreg.localeCompare(b.nombCorreg);
        });
    return base;
  }, [search, options]);

  const maxUltimoPeriodo = useMemo(() => computeMaxUltimoPeriodo(options), [options]);

  const selectedOption = useMemo(
    () => options.find((o) => o.nombCorreg === value),
    [options, value],
  );

  // Conteo por seccion para los headers
  const sectionCounts = useMemo(() => {
    if (isSearching) return {} as Record<string, number>;
    return sorted.reduce<Record<string, number>>((acc, o) => {
      const k = getSectionKey(o.tipoEntidad);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  }, [sorted, isSearching]);

  useEffect(() => { setActiveIdx(0); }, [search]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const seleccionar = (nomb: string) => { onChange(nomb); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, sorted.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const opt = sorted[activeIdx]; if (opt) seleccionar(opt.nombCorreg); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label && (
        <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1 mb-1">
          <Building2 className="w-3 h-3" />
          {label}
        </label>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full h-9 px-3 text-sm rounded-md border bg-white text-left flex items-center justify-between gap-2 transition-colors",
          "border-slate-300 hover:border-slate-400",
          open && "border-brand-500 ring-2 ring-brand-100",
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="truncate text-slate-900">{value || "—"}</span>
          {selectedOption?.tipoEntidad?.startsWith("COOPAC_") && selectedOption.tipoEntidad && (
            <CoopacBadge nivel={selectedOption.tipoEntidad.replace("COOPAC_", "")} />
          )}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {/* Popover — ancho propio, no limitado por el trigger */}
      {open && (
        <div
          className="absolute z-50 mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
          style={{ width: "min(calc(100vw - 2rem), 580px)" }}
        >
          {/* Search */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/50">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="w-full h-8 pl-8 pr-2 text-sm rounded border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1 px-1">
              {sorted.length} de {options.length}
              {" · "}
              <span className="text-slate-400">↑↓ navegar · Enter elegir · Esc cerrar</span>
            </p>
          </div>

          {/* Lista */}
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {sorted.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                Sin resultados para <span className="font-mono">&quot;{search}&quot;</span>
              </div>
            ) : (
              sorted.map((opt, idx) => {
                const isActive = idx === activeIdx;
                const isSelected = opt.nombCorreg === value;
                const curKey = getSectionKey(opt.tipoEntidad);
                const prevKey = idx > 0 ? getSectionKey(sorted[idx - 1].tipoEntidad) : null;
                const isCoopac = opt.tipoEntidad?.startsWith("COOPAC_");

                // Cabecera de seccion: aparece cuando cambia el grupo (solo sin busqueda)
                const showHeader = !isSearching && curKey !== prevKey;
                const isCoopacSection = curKey !== "__SF__";

                return (
                  <Fragment key={opt.nombCorreg}>
                    {showHeader && (
                      <div
                        className={cn(
                          "flex items-center justify-between px-3 py-1.5",
                          idx > 0 && "mt-0.5 border-t",
                          isCoopacSection
                            ? "bg-teal-50/70 border-teal-100"
                            : "bg-slate-50/80 border-slate-100",
                        )}
                      >
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider",
                            isCoopacSection ? "text-teal-600" : "text-slate-400",
                          )}
                        >
                          {getSectionLabel(curKey)}
                        </span>
                        <span className={cn("text-[10px]", isCoopacSection ? "text-teal-400" : "text-slate-400")}>
                          {sectionCounts[curKey] ?? 0}
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      data-idx={idx}
                      onClick={() => seleccionar(opt.nombCorreg)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
                        isActive && "bg-brand-50",
                        isSelected && !isActive && "bg-slate-50",
                      )}
                    >
                      <Check
                        className={cn("w-3.5 h-3.5 flex-shrink-0", isSelected ? "text-brand-600" : "text-transparent")}
                      />
                      {/* Nombre: sin truncar tanto — el popover es ancho ahora */}
                      <span className="text-sm text-slate-800 flex-1 truncate">
                        {highlightMatch(opt.nombCorreg, search)}
                      </span>
                      {/* Badge de nivel: solo visible cuando se busca (en la lista agrupada
                          el nivel ya esta en el header de seccion, seria redundante) */}
                      {isSearching && isCoopac && opt.tipoEntidad && (
                        <CoopacBadge nivel={opt.tipoEntidad.replace("COOPAC_", "")} />
                      )}
                      <EntidadFreshnessBadge
                        ultimoPeriodo={opt.ultimoPeriodo}
                        maxDisponible={maxUltimoPeriodo}
                      />
                      {opt.primerPeriodo != null && opt.ultimoPeriodo != null && (
                        <span className="text-[10px] font-mono text-slate-400 flex-shrink-0 whitespace-nowrap">
                          {opt.primerPeriodo} – {opt.ultimoPeriodo}
                        </span>
                      )}
                    </button>
                  </Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CoopacBadge({ nivel }: { nivel: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-px text-[9px] font-bold rounded bg-teal-100 text-teal-700 tracking-wide flex-shrink-0">
      {nivel}
    </span>
  );
}

function highlightMatch(text: string, search: string): React.ReactNode {
  if (!search.trim()) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-slate-900 font-semibold rounded-sm px-0.5">
        {text.slice(idx, idx + search.length)}
      </mark>
      {text.slice(idx + search.length)}
    </>
  );
}
