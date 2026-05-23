"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridReadyEvent, ValueFormatterParams } from "ag-grid-community";
import { ClientSideRowModelModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { BarChart3, Download, Save, Palette } from "lucide-react";

import { formatNumber } from "@/app/dashboard/_lib/format";

import { ChartPanel } from "./chart-panel";
import { exportarAExcel } from "./xlsx-export";
import { FieldPicker } from "./field-picker";
import { WorkspacesSidebar } from "./workspaces-sidebar";
import {
  type FormatoCondicional,
  calcularStatsColumna,
  makeCellStyle,
} from "./conditional-formatting";
import {
  DEFAULT_CONFIG,
  type ColumnasDisponibles,
  type PivotConfig,
  type PivotResultado,
} from "./types";

// AG Grid v32 requiere registrar modulos antes del primer render.
ModuleRegistry.registerModules([ClientSideRowModelModule]);

export function AnalisisClient() {
  const [config, setConfig] = useState<PivotConfig>(DEFAULT_CONFIG);
  const [columnas, setColumnas] = useState<ColumnasDisponibles | null>(null);
  const [resultado, setResultado] = useState<PivotResultado | null>(null);
  const [cargandoCols, setCargandoCols] = useState(false);
  const [cargandoPivot, setCargandoPivot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspacesAbierto, setWorkspacesAbierto] = useState(false);
  const [chartAbierto, setChartAbierto] = useState(false);
  // Map columna -> formato condicional. Se persiste con el workspace.
  const [formatoCondicional, setFormatoCondicional] = useState<
    Record<string, FormatoCondicional>
  >({});

  // Cargar columnas cuando cambia la fuente.
  // Al cambiar de fuente:
  //   1) limpiamos el resultado anterior para no mostrar datos viejos del Balance
  //      mientras esperamos los nuevos de Resultados/Ratios.
  //   2) podamos medidas/dimensiones que no existan en el nuevo schema (ej. cta_a
  //      es valido en balance pero no en resultados). Sin esto, el auto-ejecutor
  //      dispara el pivot con columnas invalidas y aparece "Columna no permitida".
  useEffect(() => {
    let alive = true;
    setCargandoCols(true);
    setError(null);
    setResultado(null);
    fetch(`/api/v1/pivot/columnas?fuente=${config.fuente}`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json.error) {
          setError(json.error.message ?? "Error cargando columnas");
          return;
        }
        const cols = json.data as ColumnasDisponibles;
        setColumnas(cols);
        const dimsValidas = new Set(cols.dimensiones.map((c) => c.key));
        const medsValidas = new Set(cols.medidas.map((c) => c.key));
        setConfig((cfg) => {
          const dimsNew = cfg.dimensiones.filter((k) => dimsValidas.has(k));
          const medsNew = cfg.medidas.filter((k) => medsValidas.has(k));
          if (
            dimsNew.length === cfg.dimensiones.length &&
            medsNew.length === cfg.medidas.length
          ) {
            return cfg;
          }
          return { ...cfg, dimensiones: dimsNew, medidas: medsNew };
        });
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setCargandoCols(false);
      });
    return () => {
      alive = false;
    };
  }, [config.fuente]);

  // Ejecutar pivot
  const ejecutarPivot = useCallback(async () => {
    setCargandoPivot(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fuente: config.fuente,
          dimensiones: config.dimensiones,
          medidas: config.medidas,
          agregacion: config.agregacion,
          filtros: config.filtros,
          limite: 10_000,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error.message ?? "Error ejecutando pivot");
        return;
      }
      setResultado(json.data as PivotResultado);
    } catch (e) {
      setError(String(e));
    } finally {
      setCargandoPivot(false);
    }
  }, [config]);

  // Auto-ejecutar al cambiar config (con debounce simple)
  useEffect(() => {
    if (!columnas) return;
    if (config.dimensiones.length === 0 || config.medidas.length === 0) return;
    const t = window.setTimeout(() => {
      ejecutarPivot();
    }, 250);
    return () => window.clearTimeout(t);
  }, [config, columnas, ejecutarPivot]);

  // Definicion de columnas de AG Grid
  const colDefs: ColDef[] = useMemo(() => {
    if (!resultado) return [];
    return resultado.columnas.map((c) => {
      const def: ColDef = {
        field: c.key,
        headerName: c.label,
        sortable: true,
        resizable: true,
        filter: c.esNumerico ? "agNumberColumnFilter" : "agTextColumnFilter",
      };
      if (c.tipo === "dimension") {
        def.pinned = "left";
        def.minWidth = 140;
        def.cellClass = "font-medium text-slate-900";
      } else {
        def.minWidth = 110;
        def.type = "rightAligned";
        def.valueFormatter = (p: ValueFormatterParams) => {
          if (p.value === null || p.value === undefined) return "—";
          const n = Number(p.value);
          if (!Number.isFinite(n)) return String(p.value);
          return formatNumber(n, 0);
        };
        def.cellClass = "tabular-nums text-slate-700";

        // Aplicar formato condicional si la columna lo tiene configurado
        const cfg = formatoCondicional[c.key];
        if (cfg) {
          const stats = calcularStatsColumna(resultado.filas, c.key);
          const styleFn = makeCellStyle(cfg, stats);
          def.cellStyle = (params) => styleFn(params) ?? undefined;
        }
      }
      return def;
    });
  }, [resultado, formatoCondicional]);

  // Toggle de formato condicional por columna (cicla: none -> heatmap -> barras -> none)
  const ciclarFormato = useCallback((columnaKey: string) => {
    setFormatoCondicional((prev) => {
      const actual = prev[columnaKey];
      const next: Record<string, FormatoCondicional> = { ...prev };
      if (!actual) next[columnaKey] = { tipo: "heatmap" };
      else if (actual.tipo === "heatmap") next[columnaKey] = { tipo: "barras" };
      else delete next[columnaKey];
      return next;
    });
  }, []);

  // Default ColDef
  const defaultColDef: ColDef = useMemo(
    () => ({
      minWidth: 100,
      flex: 0,
    }),
    [],
  );

  const onGridReady = useCallback((params: GridReadyEvent) => {
    params.api.sizeColumnsToFit();
  }, []);

  // Export a XLSX con formato (encabezados, tabular nums, congelar dimensiones)
  const exportarXlsx = useCallback(async () => {
    if (!resultado) return;
    await exportarAExcel(resultado, {
      filename: `aibenchef_${config.fuente}_${Date.now()}.xlsx`,
      hojaNombre: "Pivot",
    });
  }, [resultado, config.fuente]);

  return (
    <div className="flex h-[calc(100vh-120px)] bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <FieldPicker
        config={config}
        columnas={columnas}
        loading={cargandoCols || cargandoPivot}
        onChange={setConfig}
        onEjecutar={ejecutarPivot}
        onGuardar={() => setWorkspacesAbierto(true)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-slate-200 px-4 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold text-slate-900">Analisis Dinamico</span>
            {resultado && (
              <span className="text-xs text-slate-500">
                {resultado.totalFilas.toLocaleString("es-PE")} filas en {resultado.duracionMs}ms
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <FormatoMenu
              resultado={resultado}
              formatoActual={formatoCondicional}
              onToggle={ciclarFormato}
            />
            <button
              type="button"
              onClick={() => setChartAbierto((v) => !v)}
              disabled={!resultado}
              className="h-7 px-3 text-xs bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Grafico
            </button>
            <button
              type="button"
              onClick={exportarXlsx}
              disabled={!resultado}
              className="h-7 px-3 text-xs bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar XLSX
            </button>
            <button
              type="button"
              onClick={() => setWorkspacesAbierto((v) => !v)}
              className="h-7 px-3 text-xs bg-white border border-slate-300 rounded hover:bg-slate-100 inline-flex items-center gap-1"
            >
              <Save className="w-3.5 h-3.5" />
              Workspaces
            </button>
          </div>
        </header>

        {error && (
          <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="flex-1 ag-theme-quartz" style={{ width: "100%", height: "100%" }}>
          {resultado ? (
            <AgGridReact
              rowData={resultado.filas}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              onGridReady={onGridReady}
              animateRows={false}
              suppressMovableColumns={false}
              rowSelection={{ mode: "multiRow", enableClickSelection: false }}
              cellSelection={true}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-500">
              {cargandoCols
                ? "Cargando columnas disponibles..."
                : cargandoPivot
                  ? "Ejecutando pivot..."
                  : "Selecciona dimensiones y medidas para empezar."}
            </div>
          )}
        </div>
      </div>

      {chartAbierto && resultado && (
        <ChartPanel resultado={resultado} onClose={() => setChartAbierto(false)} />
      )}

      {workspacesAbierto && (
        <WorkspacesSidebar
          configActual={config}
          onClose={() => setWorkspacesAbierto(false)}
          onCargar={(c) => {
            setConfig(c);
            setWorkspacesAbierto(false);
          }}
        />
      )}
    </div>
  );
}

function FormatoMenu({
  resultado,
  formatoActual,
  onToggle,
}: {
  resultado: PivotResultado | null;
  formatoActual: Record<string, FormatoCondicional>;
  onToggle: (key: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const medidas = resultado?.columnas.filter((c) => c.tipo === "medida") ?? [];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        disabled={!resultado}
        className="h-7 px-3 text-xs bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1"
      >
        <Palette className="w-3.5 h-3.5" />
        Formato
      </button>
      {abierto && resultado && (
        <div
          className="absolute right-0 top-9 z-30 w-72 bg-white border border-slate-200 rounded-lg shadow-lg p-2"
          onMouseLeave={() => setAbierto(false)}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-1">
            Toggle formato por columna
          </p>
          <p className="text-[10px] text-slate-500 px-2 pb-2 leading-snug">
            Click cicla: ninguno → heatmap → barras → ninguno
          </p>
          <div className="max-h-72 overflow-y-auto">
            {medidas.length === 0 ? (
              <p className="text-xs text-slate-500 px-2 py-3 text-center">
                Sin medidas para formatear
              </p>
            ) : (
              medidas.map((m) => {
                const tipo = formatoActual[m.key]?.tipo;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => onToggle(m.key)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-slate-50 rounded"
                  >
                    <span className="truncate text-slate-700">{m.label}</span>
                    <span
                      className={
                        tipo === "heatmap"
                          ? "text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded"
                          : tipo === "barras"
                            ? "text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded"
                            : "text-[10px] text-slate-400"
                      }
                    >
                      {tipo === "heatmap"
                        ? "heatmap"
                        : tipo === "barras"
                          ? "barras"
                          : "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
