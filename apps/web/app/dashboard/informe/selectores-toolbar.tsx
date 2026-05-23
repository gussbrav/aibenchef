"use client";

// Toolbar con dos controles:
//   - Selector de periodo (dropdown YYYY-MM)
//   - Editor de peer group (modal con multi-select buscable)
//
// Al cambiar algo, navega a /dashboard/informe?periodo=X&peerGroup=A,B,C
// y Next re-renderea el server component con los nuevos params.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useMemo, useState, useTransition } from "react";
import { Calendar, Users, X, Search, Check } from "lucide-react";

import type { EntidadDisponible } from "@/lib/domains/informe";

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"} ${anio}`;
}

export function SelectoresToolbar({
  periodoActual,
  peerGroupActual,
  entidadPropia,
  periodosDisponibles,
  entidadesDisponibles,
}: {
  periodoActual: number;
  peerGroupActual: string[];
  entidadPropia: string;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [editorAbierto, setEditorAbierto] = useState(false);

  const navegar = (params: { periodo?: number; peerGroup?: string[] }) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (params.periodo !== undefined) sp.set("periodo", String(params.periodo));
    if (params.peerGroup !== undefined) {
      // Excluir la entidad propia del CSV (siempre la inyecta el backend)
      const filtered = params.peerGroup.filter((p) => p !== entidadPropia);
      if (filtered.length > 0) sp.set("peerGroup", filtered.join(","));
      else sp.delete("peerGroup");
    }
    startTransition(() => {
      router.push(`${pathname}?${sp.toString()}` as Route);
    });
  };

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Periodo:</label>
          <select
            value={periodoActual}
            onChange={(e) => navegar({ periodo: Number.parseInt(e.target.value, 10) })}
            disabled={isPending || periodosDisponibles.length === 0}
            className="h-8 px-2 text-sm border border-slate-300 rounded bg-white min-w-[120px] disabled:opacity-50"
          >
            {!periodosDisponibles.includes(periodoActual) && (
              <option value={periodoActual}>{periodoLabel(periodoActual)} (actual)</option>
            )}
            {periodosDisponibles.map((p) => (
              <option key={p} value={p}>
                {periodoLabel(p)} ({p})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Peer group ({peerGroupActual.length} entidades):
          </label>
          <button
            type="button"
            onClick={() => setEditorAbierto(true)}
            disabled={isPending}
            className="h-8 px-3 text-sm bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors disabled:opacity-50"
          >
            Editar
          </button>
        </div>

        {isPending && (
          <span className="text-xs text-slate-500 inline-flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            Cargando...
          </span>
        )}
      </div>

      {editorAbierto && (
        <PeerGroupEditor
          peerGroupActual={peerGroupActual}
          entidadPropia={entidadPropia}
          entidadesDisponibles={entidadesDisponibles}
          onClose={() => setEditorAbierto(false)}
          onAplicar={(nuevo) => {
            setEditorAbierto(false);
            navegar({ peerGroup: nuevo });
          }}
        />
      )}
    </>
  );
}

function PeerGroupEditor({
  peerGroupActual,
  entidadPropia,
  entidadesDisponibles,
  onClose,
  onAplicar,
}: {
  peerGroupActual: string[];
  entidadPropia: string;
  entidadesDisponibles: EntidadDisponible[];
  onClose: () => void;
  onAplicar: (nuevo: string[]) => void;
}) {
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set(peerGroupActual));
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const e of entidadesDisponibles) set.add(e.tipoEntidad);
    return Array.from(set).sort();
  }, [entidadesDisponibles]);

  const filtradas = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return entidadesDisponibles.filter((e) => {
      if (filtroTipo && e.tipoEntidad !== filtroTipo) return false;
      if (!q) return true;
      return e.nombCorreg.toLowerCase().includes(q) || e.tipoEntidad.toLowerCase().includes(q);
    });
  }, [entidadesDisponibles, busqueda, filtroTipo]);

  const toggle = (nomb: string) => {
    if (nomb === entidadPropia) return; // no se puede sacar
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(nomb)) next.delete(nomb);
      else next.add(nomb);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Editar Peer Group</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Selecciona las entidades que aparecen en el informe. La entidad propia ({entidadPropia}) siempre se incluye.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </header>

        <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-slate-50 rounded px-3 h-9 border border-slate-300 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar entidad..."
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setFiltroTipo(null)}
              className={`px-2 py-1 text-xs rounded ${filtroTipo === null ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              Todos
            </button>
            {tiposDisponibles.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFiltroTipo(t)}
                className={`px-2 py-1 text-xs rounded ${filtroTipo === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {filtradas.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No hay entidades que coincidan con el filtro.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtradas.map((e) => {
                const checked = seleccionadas.has(e.nombCorreg);
                const esPropio = e.nombCorreg === entidadPropia;
                return (
                  <li key={e.nombCorreg}>
                    <label
                      className={`flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 px-2 rounded ${
                        esPropio ? "opacity-90" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={esPropio}
                        onChange={() => toggle(e.nombCorreg)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 truncate">
                          {e.nombCorreg}
                          {esPropio && (
                            <span className="ml-2 text-[10px] uppercase font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">
                              propia
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {e.tipoEntidad} {e.microfinanciera ? "· microfinanciera" : ""}
                        </p>
                      </div>
                      {checked && <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <p className="text-xs text-slate-600">
            <strong>{seleccionadas.size}</strong> entidades seleccionadas
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-sm rounded transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onAplicar(Array.from(seleccionadas))}
              disabled={seleccionadas.size === 0}
              className="h-9 px-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
            >
              Aplicar ({seleccionadas.size})
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
