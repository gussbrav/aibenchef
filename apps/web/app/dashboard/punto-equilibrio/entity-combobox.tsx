"use client";

/**
 * EntityCombobox — selector de entidad con search, keyboard nav y look
 * premium tipo Linear/Vercel/Notion. Reemplaza el <select> nativo (feo
 * y sin busqueda) por un combobox accesible que escala a 300+ opciones.
 *
 * Features:
 *   - Boton trigger con nombre actual + badge nivel COOPAC si aplica
 *   - Popover con search autofocus al abrir
 *   - Filtro fuzzy (case-insensitive, substring match)
 *   - Keyboard nav: ArrowUp/Down mueve, Enter selecciona, Esc cierra
 *   - Click fuera cierra
 *   - Rango de data disponible junto a cada opcion (opcional)
 *   - Item activo destacado con background brand
 *   - Scroll auto-follow del item activo
 *   - Section headers "Sistema Financiero" / "Cooperativas" cuando no hay busqueda
 *   - Badge nivel COOPAC (N3/N2B/N2A/N1) junto al nombre de cada cooperativa
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
  /** Tipo de entidad (ej. 'COOPAC_N3', 'CMAC', 'BANCOS'). Permite badgear
   *  cooperativas y agruparlas en secciones separadas del Sistema Financiero. */
  tipoEntidad?: string | null;
};

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

  // Lista filtrada y ordenada:
  //   - Sin busqueda: SF primero (orden original), luego COOPAC (orden original).
  //   - Con busqueda: plana (sin reordenar), para que el match mas relevante
  //     quede donde el usuario lo espera.
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? options.filter((o) => o.nombCorreg.toLowerCase().includes(q)) : options;
    if (q) return base;
    const sf = base.filter(o => !o.tipoEntidad?.startsWith("COOPAC_"));
    const coopac = base.filter(o => o.tipoEntidad?.startsWith("COOPAC_"));
    return [...sf, ...coopac];
  }, [search, options]);

  // Max ultimoPeriodo del universo para el badge "sin data reciente".
  const maxUltimoPeriodo = useMemo(
    () => computeMaxUltimoPeriodo(options),
    [options],
  );

  // Entidad actualmente seleccionada — para mostrar badge en el trigger.
  const selectedOption = useMemo(
    () => options.find(o => o.nombCorreg === value),
    [options, value],
  );

  useEffect(() => {
    setActiveIdx(0);
  }, [search]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const seleccionar = (nomb: string) => {
    onChange(nomb);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, sorted.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = sorted[activeIdx];
      if (opt) seleccionar(opt.nombCorreg);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const isSearching = search.trim() !== "";
  const sfCount = sorted.filter(o => !o.tipoEntidad?.startsWith("COOPAC_")).length;
  const coopacCount = sorted.filter(o => o.tipoEntidad?.startsWith("COOPAC_")).length;
  const showSections = !isSearching && coopacCount > 0 && sfCount > 0;

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
            <CoopacNivelBadge tipo={selectedOption.tipoEntidad} />
          )}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-400 flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute z-50 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
          style={{ maxWidth: "min(100%, 480px)" }}
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
          <div
            ref={listRef}
            className="max-h-72 overflow-y-auto py-1"
          >
            {sorted.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-500">
                Sin resultados para <span className="font-mono">&quot;{search}&quot;</span>
              </div>
            ) : (
              sorted.map((opt, idx) => {
                const isCoopac = opt.tipoEntidad?.startsWith("COOPAC_");
                const prevIsCoopac = sorted[idx - 1]?.tipoEntidad?.startsWith("COOPAC_");
                const isActive = idx === activeIdx;
                const isSelected = opt.nombCorreg === value;

                // Section header: se inyecta en la transicion SF→COOPAC.
                let sectionHeader: React.ReactNode = null;
                if (showSections) {
                  if (!isCoopac && idx === 0) {
                    sectionHeader = (
                      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50/80 border-b border-slate-100">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          Sistema Financiero
                        </span>
                        <span className="text-[10px] text-slate-400">{sfCount}</span>
                      </div>
                    );
                  } else if (isCoopac && !prevIsCoopac) {
                    sectionHeader = (
                      <div className="flex items-center justify-between px-3 py-1.5 bg-teal-50/60 border-t border-b border-teal-100 mt-0.5">
                        <span className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider">
                          Cooperativas
                        </span>
                        <span className="text-[10px] text-teal-500">{coopacCount}</span>
                      </div>
                    );
                  }
                }

                return (
                  <Fragment key={opt.nombCorreg}>
                    {sectionHeader}
                    <button
                      type="button"
                      data-idx={idx}
                      onClick={() => seleccionar(opt.nombCorreg)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                        isActive && "bg-brand-50",
                        isSelected && !isActive && "bg-slate-50",
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <Check
                          className={cn(
                            "w-3.5 h-3.5 flex-shrink-0",
                            isSelected ? "text-brand-600" : "text-transparent",
                          )}
                        />
                        <span className="text-sm text-slate-800 truncate">
                          {highlightMatch(opt.nombCorreg, search)}
                        </span>
                        {isCoopac && opt.tipoEntidad && (
                          <CoopacNivelBadge tipo={opt.tipoEntidad} />
                        )}
                        <EntidadFreshnessBadge
                          ultimoPeriodo={opt.ultimoPeriodo}
                          maxDisponible={maxUltimoPeriodo}
                        />
                      </span>
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

function CoopacNivelBadge({ tipo }: { tipo: string }) {
  const nivel = tipo.replace("COOPAC_", "");
  return (
    <span className="inline-flex items-center px-1 py-px text-[9px] font-bold rounded-sm bg-teal-100 text-teal-700 tracking-wide flex-shrink-0">
      {nivel}
    </span>
  );
}

function highlightMatch(text: string, search: string): React.ReactNode {
  if (!search.trim()) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx < 0) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + search.length);
  const after = text.slice(idx + search.length);
  return (
    <>
      {before}
      <mark className="bg-yellow-100 text-slate-900 font-semibold rounded-sm px-0.5">
        {match}
      </mark>
      {after}
    </>
  );
}
