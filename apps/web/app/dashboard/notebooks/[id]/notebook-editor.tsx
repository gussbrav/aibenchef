"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Code,
  Play,
  Plus,
  Trash2,
  Type,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { SqlEditor } from "@/components/sql-editor";
import { formatNumber } from "@/app/dashboard/_lib/format";
import { WidgetRenderer } from "@/app/dashboard/tableros/[id]/widget-renderer";

import type { CellTipo, Notebook, NotebookCell } from "@/lib/domains/notebooks";

type QueryResult = {
  columnas: Array<{ key: string; tipo: string }>;
  filas: Array<Record<string, unknown>>;
  totalFilas: number;
  duracionMs: number;
};

export function NotebookEditor({ notebook: initial }: { notebook: Notebook }) {
  const router = useRouter();
  const [notebook, setNotebook] = useState<Notebook>(initial);
  const [outputs, setOutputs] = useState<Record<string, QueryResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const agregarCell = async (tipo: CellTipo) => {
    const initialContent =
      tipo === "markdown"
        ? "## Titulo de seccion\n\nEscribe markdown aqui."
        : tipo === "sql"
          ? "-- Escribe tu SQL aqui\nSELECT * FROM marts.mv_eeff_ratios LIMIT 10;"
          : "";
    try {
      const r = await fetch(`/api/v1/notebooks/${notebook.id}/cells`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, contenido: initialContent }),
      });
      const json = await r.json();
      if (json.data) {
        setNotebook((n) => ({ ...n, cells: [...n.cells, json.data as NotebookCell] }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const guardarCell = useCallback(
    async (cellId: string, contenido: string, config?: Record<string, unknown>) => {
      try {
        await fetch(`/api/v1/notebooks/${notebook.id}/cells/${cellId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contenido, ...(config !== undefined ? { config } : {}) }),
        });
        setNotebook((n) => ({
          ...n,
          cells: n.cells.map((c) =>
            c.id === cellId ? { ...c, contenido, ...(config !== undefined ? { config } : {}) } : c,
          ),
        }));
      } catch (e) {
        console.error(e);
      }
    },
    [notebook.id],
  );

  const eliminarCell = async (cellId: string) => {
    if (!confirm("Eliminar esta cell?")) return;
    try {
      await fetch(`/api/v1/notebooks/${notebook.id}/cells/${cellId}`, { method: "DELETE" });
      setNotebook((n) => ({ ...n, cells: n.cells.filter((c) => c.id !== cellId) }));
      setOutputs((o) => {
        const { [cellId]: _, ...rest } = o;
        return rest;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const ejecutarSql = async (cellId: string, sql: string) => {
    setRunning(cellId);
    setErrors((e) => ({ ...e, [cellId]: "" }));
    try {
      const r = await fetch("/api/v1/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sqlText: sql }),
      });
      const json = await r.json();
      if (json.error) {
        setErrors((e) => ({ ...e, [cellId]: json.error.message ?? "Error" }));
      } else {
        setOutputs((o) => ({ ...o, [cellId]: json.data as QueryResult }));
      }
    } catch (e) {
      setErrors((er) => ({ ...er, [cellId]: String(e) }));
    } finally {
      setRunning(null);
    }
  };

  const moverCell = async (cellId: string, direccion: -1 | 1) => {
    const idx = notebook.cells.findIndex((c) => c.id === cellId);
    if (idx < 0) return;
    const newIdx = idx + direccion;
    if (newIdx < 0 || newIdx >= notebook.cells.length) return;
    const reordered = [...notebook.cells];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx]!, reordered[idx]!];
    // Reasignar orden 0..N
    const updates = reordered.map((c, i) => ({ ...c, orden: i }));
    setNotebook((n) => ({ ...n, cells: updates }));
    // Persistir
    try {
      await Promise.all(
        [reordered[idx], reordered[newIdx]].map((c, i) =>
          fetch(`/api/v1/notebooks/${notebook.id}/cells/${c!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orden: i === 0 ? idx : newIdx }),
          }),
        ),
      );
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/dashboard/notebooks" as never)}
          className="text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 truncate">
            {notebook.titulo}
          </h1>
          {notebook.descripcion && (
            <p className="text-xs text-slate-500 truncate">{notebook.descripcion}</p>
          )}
        </div>
      </header>

      <div className="space-y-3">
        {notebook.cells.map((cell, idx) => (
          <CellView
            key={cell.id}
            cell={cell}
            output={outputs[cell.id]}
            error={errors[cell.id]}
            isRunning={running === cell.id}
            isFirst={idx === 0}
            isLast={idx === notebook.cells.length - 1}
            todasCells={notebook.cells}
            onChange={guardarCell}
            onDelete={() => eliminarCell(cell.id)}
            onMove={(dir) => moverCell(cell.id, dir)}
            onRun={(sql) => ejecutarSql(cell.id, sql)}
          />
        ))}
      </div>

      {/* Add cell buttons */}
      <div className="flex justify-center gap-2 py-4 border-t border-slate-200">
        <button
          type="button"
          onClick={() => agregarCell("markdown")}
          className="inline-flex items-center gap-1.5 px-3 h-8 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded"
        >
          <Type className="w-3.5 h-3.5" />
          Markdown
        </button>
        <button
          type="button"
          onClick={() => agregarCell("sql")}
          className="inline-flex items-center gap-1.5 px-3 h-8 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded"
        >
          <Code className="w-3.5 h-3.5" />
          SQL
        </button>
        <button
          type="button"
          onClick={() => agregarCell("chart")}
          className="inline-flex items-center gap-1.5 px-3 h-8 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Chart
        </button>
      </div>
    </div>
  );
}

function CellView({
  cell,
  output,
  error,
  isRunning,
  isFirst,
  isLast,
  todasCells,
  onChange,
  onDelete,
  onMove,
  onRun,
}: {
  cell: NotebookCell;
  output?: QueryResult;
  error?: string;
  isRunning: boolean;
  isFirst: boolean;
  isLast: boolean;
  todasCells: NotebookCell[];
  onChange: (id: string, contenido: string, config?: Record<string, unknown>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onRun: (sql: string) => void;
}) {
  const [contenido, setContenido] = useState(cell.contenido);
  const [config, setConfig] = useState(cell.config);

  const guardar = () => onChange(cell.id, contenido, config);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <header className="h-9 px-3 flex items-center justify-between border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "px-2 py-0.5 rounded font-mono uppercase font-semibold text-[10px]",
              cell.tipo === "markdown" && "bg-blue-100 text-blue-700",
              cell.tipo === "sql" && "bg-violet-100 text-violet-700",
              cell.tipo === "chart" && "bg-emerald-100 text-emerald-700",
            )}
          >
            {cell.tipo}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            aria-label="Subir"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            aria-label="Bajar"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1 text-slate-400 hover:text-rose-600"
            aria-label="Eliminar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="p-3">
        {cell.tipo === "markdown" && (
          <textarea
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            onBlur={guardar}
            rows={Math.min(20, Math.max(3, contenido.split("\n").length))}
            className="w-full px-3 py-2 text-sm rounded border border-slate-200 outline-none resize-y font-mono"
          />
        )}
        {cell.tipo === "sql" && (
          <>
            <div className="h-48 border border-slate-200 rounded overflow-hidden mb-2">
              <SqlEditor
                value={contenido}
                onChange={setContenido}
                onRun={() => {
                  guardar();
                  onRun(contenido);
                }}
                onSave={guardar}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  guardar();
                  onRun(contenido);
                }}
                disabled={isRunning}
                className="inline-flex items-center gap-1 px-3 h-7 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded"
              >
                <Play className="w-3 h-3" />
                {isRunning ? "Corriendo..." : "Ejecutar"}
              </button>
              {output && (
                <span className="text-[10px] text-slate-500">
                  {formatNumber(output.totalFilas)} filas · {output.duracionMs}ms
                </span>
              )}
            </div>
            {error && (
              <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 font-mono whitespace-pre-wrap">
                {error}
              </div>
            )}
            {output && output.filas.length > 0 && (
              <div className="mt-2 border border-slate-200 rounded overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      {output.columnas.map((c) => (
                        <th
                          key={c.key}
                          className="text-left px-2 py-1.5 font-semibold text-slate-600 font-mono whitespace-nowrap"
                        >
                          {c.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {output.filas.slice(0, 50).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {output.columnas.map((c) => {
                          const v = row[c.key];
                          const isNum = c.tipo === "number";
                          return (
                            <td
                              key={c.key}
                              className={cn(
                                "px-2 py-1 whitespace-nowrap",
                                isNum && "text-right tabular-nums",
                              )}
                            >
                              {v === null || v === undefined
                                ? "—"
                                : isNum
                                  ? formatNumber(Number(v), 2)
                                  : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {output.filas.length > 50 && (
                  <div className="px-2 py-1 text-[10px] text-slate-500 text-center bg-slate-50">
                    Mostrando 50 de {output.filas.length} filas
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {cell.tipo === "chart" && (
          <ChartCellView
            cell={cell}
            todasCells={todasCells}
            config={config}
            onConfigChange={(c) => {
              setConfig(c);
              onChange(cell.id, contenido, c);
            }}
          />
        )}
      </div>
    </div>
  );
}

function ChartCellView({
  cell,
  todasCells,
  config,
  onConfigChange,
}: {
  cell: NotebookCell;
  todasCells: NotebookCell[];
  config: Record<string, unknown>;
  onConfigChange: (c: Record<string, unknown>) => void;
}) {
  const sqlCells = todasCells.filter((c) => c.tipo === "sql");
  const fuenteSql = (config.fuenteCellId as string | undefined) ?? "";
  const fuenteSqlCell = todasCells.find((c) => c.id === fuenteSql);

  // Simulamos un widget de tipo chart con el SQL de la fuente y la config local
  const widgetTipo = (config.tipo as string | undefined) ?? "chart_bar";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widget: any = {
    id: cell.id,
    tableroId: "",
    tipo: widgetTipo,
    titulo: null,
    config: {
      sql: fuenteSqlCell?.contenido,
      xKey: config.xKey,
      yKeys: config.yKeys,
      seriesKey: config.seriesKey,
      formato: config.formato,
      decimales: config.decimales,
    },
    posX: 0,
    posY: 0,
    posW: 12,
    posH: 6,
    orden: 0,
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <label className="block text-xs">
          <span className="block font-semibold text-slate-700 mb-1">Tipo</span>
          <select
            value={widgetTipo}
            onChange={(e) => onConfigChange({ ...config, tipo: e.target.value })}
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            <option value="chart_line">Linea</option>
            <option value="chart_bar">Barras</option>
            <option value="chart_area">Area</option>
            <option value="chart_pie">Torta</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="block font-semibold text-slate-700 mb-1">Fuente (SQL cell)</span>
          <select
            value={fuenteSql}
            onChange={(e) => onConfigChange({ ...config, fuenteCellId: e.target.value })}
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            <option value="">— Selecciona —</option>
            {sqlCells.map((c, i) => (
              <option key={c.id} value={c.id}>
                SQL #{i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="block font-semibold text-slate-700 mb-1">X (col)</span>
          <input
            value={(config.xKey as string) ?? ""}
            onChange={(e) => onConfigChange({ ...config, xKey: e.target.value })}
            className="w-full h-8 px-2 text-xs rounded border border-slate-300"
          />
        </label>
        <label className="block text-xs">
          <span className="block font-semibold text-slate-700 mb-1">Y keys (csv)</span>
          <input
            value={Array.isArray(config.yKeys) ? (config.yKeys as string[]).join(",") : ""}
            onChange={(e) =>
              onConfigChange({
                ...config,
                yKeys: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            className="w-full h-8 px-2 text-xs rounded border border-slate-300"
          />
        </label>
      </div>
      <div className="h-72 border border-slate-200 rounded">
        {fuenteSqlCell ? (
          <WidgetRenderer widget={widget} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Selecciona una cell SQL como fuente.
          </div>
        )}
      </div>
    </div>
  );
}
