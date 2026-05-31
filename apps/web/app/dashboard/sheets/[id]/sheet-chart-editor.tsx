"use client";

/**
 * Modal de edicion de chart embebido en una Sheet.
 *
 * Permite crear o editar: tipo, titulo, rango (A1:C10), headerRow,
 * eje X (que columna del rango), titulos de eje, formato eje Y (number /
 * percent / thousands). Live preview a la derecha mientras editas.
 *
 * Inspirado en el panel "Dar formato a eje" de Excel pero sin copiar
 * iconos ni texto — terminologia generica.
 */

import { useEffect, useMemo, useState } from "react";
import { BarChart3, LineChart as LineIcon, PieChart as PieIcon, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { SheetCells, SheetChart as ChartDef } from "@/lib/domains/sheets";

import { SheetChart } from "./sheet-chart";

const TIPOS: Array<{ tipo: ChartDef["tipo"]; label: string; icon: typeof BarChart3 }> = [
  { tipo: "line", label: "Linea", icon: LineIcon },
  { tipo: "bar", label: "Barras", icon: BarChart3 },
  { tipo: "area", label: "Area", icon: LineIcon },
  { tipo: "pie", label: "Torta", icon: PieIcon },
];

const FORMATOS: Array<{ value: "number" | "percent" | "thousands"; label: string }> = [
  { value: "number", label: "Numero" },
  { value: "thousands", label: "Miles (k)" },
  { value: "percent", label: "Porcentaje" },
];

export function SheetChartEditor({
  cells,
  initial,
  onCancel,
  onSave,
}: {
  cells: SheetCells;
  initial: ChartDef | null;
  onCancel: () => void;
  onSave: (chart: ChartDef) => void;
}) {
  const [tipo, setTipo] = useState<ChartDef["tipo"]>(initial?.tipo ?? "bar");
  const [titulo, setTitulo] = useState(initial?.titulo ?? "Sin titulo");
  const [rango, setRango] = useState(initial?.rango ?? "A1:B10");
  const [headerRow, setHeaderRow] = useState(initial?.headerRow ?? true);
  const [xColumn, setXColumn] = useState(initial?.xColumn ?? "A");
  const [tituloEjeX, setTituloEjeX] = useState(initial?.config?.ejeX?.titulo ?? "");
  const [tituloEjeY, setTituloEjeY] = useState(initial?.config?.ejeY?.titulo ?? "");
  const [formatoY, setFormatoY] = useState<"number" | "percent" | "thousands">(
    initial?.config?.ejeY?.formato ?? "number",
  );
  const [error, setError] = useState<string | null>(null);

  // Validar rango cada vez que cambia
  useEffect(() => {
    const ok = /^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(rango);
    setError(ok ? null : "Rango invalido. Formato esperado: A1:C10");
  }, [rango]);

  const preview: ChartDef = useMemo(
    () => ({
      id: initial?.id ?? "preview",
      tipo,
      titulo: titulo.trim() || "Sin titulo",
      rango: rango.trim().toUpperCase(),
      headerRow,
      xColumn: xColumn.trim().toUpperCase() || "A",
      config: {
        ejeX: { titulo: tituloEjeX.trim() || undefined },
        ejeY: {
          titulo: tituloEjeY.trim() || undefined,
          formato: formatoY,
        },
      },
    }),
    [tipo, titulo, rango, headerRow, xColumn, tituloEjeX, tituloEjeY, formatoY, initial?.id],
  );

  const guardar = () => {
    if (error) return;
    onSave(preview);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl mx-4 h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            {initial ? "Editar grafico" : "Insertar grafico"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 p-1"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
          {/* Panel izquierdo: config */}
          <div className="col-span-5 border-r border-slate-200 overflow-y-auto p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tipo de grafico
              </label>
              <div className="grid grid-cols-4 gap-1">
                {TIPOS.map((t) => {
                  const Icon = t.icon;
                  const active = tipo === t.tipo;
                  return (
                    <button
                      key={t.tipo}
                      type="button"
                      onClick={() => setTipo(t.tipo)}
                      className={cn(
                        "flex flex-col items-center gap-1 py-2 rounded border text-[11px] transition",
                        active
                          ? "bg-brand-50 border-brand-300 text-brand-900 font-semibold"
                          : "border-slate-200 hover:bg-slate-50 text-slate-700",
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Titulo
              </label>
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
                className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Rango de datos
                </label>
                <input
                  type="text"
                  value={rango}
                  onChange={(e) => setRango(e.target.value)}
                  placeholder="A1:C10"
                  className="w-full h-9 px-3 text-sm font-mono rounded border border-slate-300 focus:border-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Columna eje X
                </label>
                <input
                  type="text"
                  value={xColumn}
                  onChange={(e) => setXColumn(e.target.value)}
                  placeholder="A"
                  maxLength={3}
                  className="w-full h-9 px-3 text-sm font-mono rounded border border-slate-300 focus:border-brand-500 outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={headerRow}
                onChange={(e) => setHeaderRow(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>
                <strong>Primera fila es header</strong> — usar los textos de la primera fila
                del rango como nombres de serie.
              </span>
            </label>

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Formato de ejes
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Titulo eje X
                </label>
                <input
                  type="text"
                  value={tituloEjeX}
                  onChange={(e) => setTituloEjeX(e.target.value)}
                  placeholder="(opcional)"
                  maxLength={120}
                  className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Titulo eje Y
                </label>
                <input
                  type="text"
                  value={tituloEjeY}
                  onChange={(e) => setTituloEjeY(e.target.value)}
                  placeholder="(opcional)"
                  maxLength={120}
                  className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Formato eje Y
                </label>
                <select
                  value={formatoY}
                  onChange={(e) =>
                    setFormatoY(e.target.value as "number" | "percent" | "thousands")
                  }
                  className="w-full h-9 px-2 text-sm rounded border border-slate-300 bg-white"
                >
                  {FORMATOS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
                {error}
              </div>
            )}
          </div>

          {/* Panel derecho: preview */}
          <div className="col-span-7 bg-slate-50 p-5 flex flex-col">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Vista previa
            </p>
            <div className="flex-1 bg-white border border-slate-200 rounded-lg p-3 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-900 mb-2 truncate">
                {preview.titulo}
              </h3>
              <div className="flex-1 min-h-0">
                <SheetChart chart={preview} cells={cells} />
              </div>
            </div>
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 h-9 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!!error}
            className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
          >
            {initial ? "Guardar cambios" : "Insertar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
