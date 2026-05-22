"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { ClientSideRowModelModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { Play, Save, Trash2, Plus, Search } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/app/dashboard/_lib/format";
import { SqlEditor } from "@/components/sql-editor";

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const SQL_DEFAULT = `-- Ejemplo: util_neta promedio por tipo_entidad ultimos 12 meses
-- Limita a app_sql_readonly: SELECT sobre marts.*, dw.*
SELECT
  tipo_entidad,
  COUNT(DISTINCT nomb_correg) AS n_entidades,
  AVG(utilidad_neta)::numeric(20,2) AS util_neta_avg,
  AVG(roa)::numeric(8,4)            AS roa_avg,
  AVG(roe)::numeric(8,4)            AS roe_avg
FROM marts.mv_eeff_ratios
WHERE moneda = 'TOTAL'
  AND periodo BETWEEN 202504 AND 202603
GROUP BY tipo_entidad
ORDER BY util_neta_avg DESC NULLS LAST;
`;

type SavedQuery = {
  id: string;
  nombre: string;
  descripcion: string | null;
  sqlText: string;
  tags: string[];
  esPublico: boolean;
  updatedAt: string;
};

type QueryResult = {
  columnas: Array<{ key: string; tipo: string }>;
  filas: Array<Record<string, unknown>>;
  totalFilas: number;
  duracionMs: number;
  truncado: boolean;
};

export function SqlWorkbenchClient() {
  const [sqlText, setSqlText] = useState<string>(SQL_DEFAULT);
  const [resultado, setResultado] = useState<QueryResult | null>(null);
  const [ejecutando, setEjecutando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [queryActualId, setQueryActualId] = useState<string | null>(null);

  // Hot-load desde sessionStorage cuando viene de Genie u otro modulo
  useEffect(() => {
    if (typeof window === "undefined") return;
    const preload = sessionStorage.getItem("aibenchef.workbench.preload");
    if (preload) {
      setSqlText(preload);
      sessionStorage.removeItem("aibenchef.workbench.preload");
    }
  }, []);

  const cargarLista = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/sql/queries");
      const json = await r.json();
      if (json.data) setSavedQueries(json.data.rows as SavedQuery[]);
    } catch (e) {
      console.error("Failed to load saved queries", e);
    }
  }, []);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  const ejecutar = useCallback(async () => {
    setEjecutando(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sqlText }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
        return;
      }
      setResultado(json.data as QueryResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setEjecutando(false);
    }
  }, [sqlText]);

  const guardar = useCallback(async () => {
    if (!nombreNuevo.trim()) return;
    try {
      const r = await fetch("/api/v1/sql/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreNuevo.trim(), sqlText }),
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
    }
  }, [nombreNuevo, sqlText, cargarLista]);

  const cargar = (q: SavedQuery) => {
    setSqlText(q.sqlText);
    setQueryActualId(q.id);
    setResultado(null);
    setError(null);
  };

  const eliminar = async (id: string) => {
    if (!confirm("Eliminar esta query?")) return;
    try {
      await fetch(`/api/v1/sql/queries/${id}`, { method: "DELETE" });
      cargarLista();
      if (queryActualId === id) {
        setQueryActualId(null);
        setSqlText(SQL_DEFAULT);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const nuevo = () => {
    setSqlText("-- Nueva query\nSELECT * FROM marts.mv_eeff_ratios LIMIT 100;\n");
    setQueryActualId(null);
    setResultado(null);
    setError(null);
  };

  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return savedQueries;
    const q = busqueda.toLowerCase();
    return savedQueries.filter(
      (sq) =>
        sq.nombre.toLowerCase().includes(q) ||
        (sq.descripcion ?? "").toLowerCase().includes(q) ||
        sq.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [savedQueries, busqueda]);

  const colDefs: ColDef[] = useMemo(() => {
    if (!resultado) return [];
    return resultado.columnas.map((c) => {
      const def: ColDef = {
        field: c.key,
        headerName: c.key,
        sortable: true,
        resizable: true,
        filter: c.tipo === "number" ? "agNumberColumnFilter" : "agTextColumnFilter",
        minWidth: 100,
      };
      if (c.tipo === "number") {
        def.type = "rightAligned";
        def.valueFormatter = (p) => {
          if (p.value === null || p.value === undefined) return "—";
          const n = Number(p.value);
          if (!Number.isFinite(n)) return String(p.value);
          return formatNumber(n, 2);
        };
        def.cellClass = "tabular-nums text-slate-700";
      }
      return def;
    });
  }, [resultado]);

  return (
    <div className="flex h-[calc(100vh-120px)] bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      {/* Sidebar saved queries */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-200 bg-slate-50/50 flex flex-col">
        <header className="h-12 border-b border-slate-200 px-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
            Queries guardadas
          </h3>
          <button
            type="button"
            onClick={nuevo}
            className="text-slate-500 hover:text-slate-800"
            title="Nueva query"
          >
            <Plus className="w-4 h-4" />
          </button>
        </header>

        <div className="p-2 border-b border-slate-200">
          <div className="flex items-center gap-1 bg-white rounded px-2 h-8 border border-slate-200">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar..."
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filtradas.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-slate-500">
              {busqueda ? "Sin coincidencias" : "No has guardado queries aun."}
            </li>
          ) : (
            filtradas.map((q) => (
              <li
                key={q.id}
                className={cn(
                  "group flex items-start gap-2 px-3 py-2 hover:bg-white cursor-pointer",
                  queryActualId === q.id && "bg-brand-50 hover:bg-brand-100",
                )}
                onClick={() => cargar(q)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">
                    {q.nombre}
                  </div>
                  {q.descripcion && (
                    <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">
                      {q.descripcion}
                    </div>
                  )}
                  {q.tags.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1">
                      {q.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1.5 py-px bg-slate-200 text-slate-700 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    eliminar(q.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600"
                  aria-label="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* Main editor + results */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-slate-200 px-4 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">SQL Workbench</h2>
            <span className="text-[10px] text-slate-500">
              <kbd className="px-1 bg-slate-200 rounded text-slate-700">Ctrl</kbd>+
              <kbd className="px-1 bg-slate-200 rounded text-slate-700">Enter</kbd> para
              ejecutar
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Nombre para guardar"
              className="h-7 px-2 text-xs border border-slate-300 rounded w-44"
            />
            <button
              type="button"
              onClick={guardar}
              disabled={!nombreNuevo.trim()}
              className="h-7 px-3 text-xs bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Save className="w-3.5 h-3.5" />
              Guardar
            </button>
            <button
              type="button"
              onClick={ejecutar}
              disabled={ejecutando}
              className="h-7 px-3 text-xs bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded font-medium inline-flex items-center gap-1"
            >
              <Play className="w-3.5 h-3.5" />
              {ejecutando ? "Ejecutando..." : "Ejecutar"}
            </button>
          </div>
        </header>

        {/* Editor Monaco (autocomplete + syntax highlight) */}
        <div className="flex-shrink-0 border-b border-slate-200" style={{ height: 280 }}>
          <SqlEditor
            value={sqlText}
            onChange={setSqlText}
            onRun={ejecutar}
            onSave={nombreNuevo.trim() ? guardar : undefined}
          />
        </div>

        {error && (
          <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 font-mono whitespace-pre-wrap">
            {error}
          </div>
        )}

        {resultado && (
          <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-600 flex items-center gap-3">
            <span>
              <span className="font-semibold">{resultado.totalFilas.toLocaleString("es-PE")}</span>{" "}
              filas
            </span>
            <span>
              <span className="font-semibold">{resultado.duracionMs}</span> ms
            </span>
            {resultado.truncado && (
              <span className="text-amber-700">truncado a 5,000 filas</span>
            )}
          </div>
        )}

        <div className="flex-1 ag-theme-quartz" style={{ width: "100%", height: "100%" }}>
          {resultado ? (
            <AgGridReact
              rowData={resultado.filas}
              columnDefs={colDefs}
              defaultColDef={{ minWidth: 100 }}
              animateRows={false}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-500">
              Ejecuta una query para ver resultados.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
