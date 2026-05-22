"use client";

import { useCallback, useEffect, useState } from "react";
import { Star, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

import type { PivotConfig } from "./types";

type Workspace = {
  id: string;
  nombre: string;
  descripcion: string | null;
  config: PivotConfig;
  esDefault: boolean;
  updatedAt: string;
};

export function WorkspacesSidebar({
  configActual,
  onClose,
  onCargar,
}: {
  configActual: PivotConfig;
  onClose: () => void;
  onCargar: (config: PivotConfig) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargarLista = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/workspaces");
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error cargando workspaces");
      } else {
        setWorkspaces(json.data.rows as Workspace[]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  const guardar = async () => {
    if (!nombreNuevo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombreNuevo.trim(),
          config: configActual,
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error guardando");
      } else {
        setNombreNuevo("");
        cargarLista();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id: string) => {
    if (!confirm("Eliminar este workspace?")) return;
    try {
      const r = await fetch(`/api/v1/workspaces/${id}`, { method: "DELETE" });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error eliminando");
      } else {
        cargarLista();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const marcarDefault = async (id: string, actualDefault: boolean) => {
    try {
      const r = await fetch(`/api/v1/workspaces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ esDefault: !actualDefault }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error actualizando");
      } else {
        cargarLista();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <aside className="w-80 border-l border-slate-200 bg-white flex flex-col h-full">
      <header className="h-12 border-b border-slate-200 px-3 flex items-center justify-between bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-900">Workspaces guardados</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="p-3 border-b border-slate-200">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Guardar config actual como
        </label>
        <div className="flex gap-1">
          <input
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            placeholder="Nombre del workspace"
            className="flex-1 h-8 px-2 text-xs rounded border border-slate-300"
            onKeyDown={(e) => {
              if (e.key === "Enter") guardar();
            }}
          />
          <button
            type="button"
            disabled={!nombreNuevo.trim() || guardando}
            onClick={guardar}
            className="h-8 px-3 text-xs bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded font-medium"
          >
            {guardando ? "..." : "Guardar"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {cargando ? (
          <p className="px-3 py-6 text-center text-xs text-slate-500">Cargando...</p>
        ) : workspaces.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-slate-500">
            Aun no has guardado ningun workspace.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {workspaces.map((w) => (
              <li
                key={w.id}
                className={cn(
                  "px-3 py-2 hover:bg-slate-50 group",
                  w.esDefault && "bg-amber-50/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onCargar(w.config)}
                    className="flex-1 text-left"
                  >
                    <div className="text-xs font-medium text-slate-900 flex items-center gap-1">
                      {w.esDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                      {w.nombre}
                    </div>
                    {w.descripcion && (
                      <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
                        {w.descripcion}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {w.config.fuente} · {w.config.dimensiones.length} dim ·{" "}
                      {w.config.medidas.length} med
                    </div>
                  </button>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => marcarDefault(w.id, w.esDefault)}
                      className="text-slate-400 hover:text-amber-500"
                      aria-label={w.esDefault ? "Quitar default" : "Marcar como default"}
                      title={w.esDefault ? "Quitar default" : "Marcar como default"}
                    >
                      <Star className={cn("w-3.5 h-3.5", w.esDefault && "fill-amber-500 text-amber-500")} />
                    </button>
                    <button
                      type="button"
                      onClick={() => eliminar(w.id)}
                      className="text-slate-400 hover:text-rose-600"
                      aria-label="Eliminar"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
