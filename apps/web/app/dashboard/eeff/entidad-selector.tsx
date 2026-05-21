"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { Entidad } from "@/lib/domains/analytics";

export function EntidadSelector({
  entidades,
  valor,
}: {
  entidades: Entidad[];
  valor: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    inputRef.current?.focus();
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const grouped = useMemo(() => {
    const norm = query.trim().toLowerCase();
    const filtered = norm
      ? entidades.filter(
          (e) =>
            e.nombCorreg.toLowerCase().includes(norm) ||
            e.tipoEntidad.toLowerCase().includes(norm) ||
            (e.empresaSbs ?? "").toLowerCase().includes(norm),
        )
      : entidades;
    const byGroup = new Map<string, Entidad[]>();
    for (const e of filtered) {
      const k = e.tipoEntidad;
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k)!.push(e);
    }
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entidades, query]);

  function selectEntidad(nombCorreg: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("entidad", nombCorreg);
    router.push(`/dashboard/eeff?${params.toString()}` as never);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative w-full sm:max-w-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-4 h-11 text-left text-sm hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate font-medium text-slate-900">{valor}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 text-slate-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full max-h-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar entidad..."
                className="h-9 w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-1">
            {grouped.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                Sin coincidencias para "{query}".
              </p>
            ) : (
              grouped.map(([grupo, items]) => (
                <div key={grupo} className="py-1">
                  <p className="px-3 py-1 text-xs font-semibold tracking-wider uppercase text-slate-500">
                    {grupo}
                  </p>
                  {items.map((e) => {
                    const selected = e.nombCorreg === valor;
                    return (
                      <button
                        key={e.nombCorreg}
                        type="button"
                        onClick={() => selectEntidad(e.nombCorreg)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-left hover:bg-slate-100",
                          selected && "bg-brand-50 text-brand-700",
                        )}
                        role="option"
                        aria-selected={selected}
                      >
                        <span className="truncate">{e.nombCorreg}</span>
                        {selected && <Check className="w-4 h-4 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
