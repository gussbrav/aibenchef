"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, LineChart as LineIcon, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { formatNumberCompact } from "@/app/dashboard/_lib/format";

import type { PivotResultado } from "./types";

type ChartTipo = "line" | "bar";

const PALETA = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

export function ChartPanel({
  resultado,
  onClose,
}: {
  resultado: PivotResultado;
  onClose: () => void;
}) {
  const dimensiones = resultado.columnas.filter((c) => c.tipo === "dimension");
  const medidas = resultado.columnas.filter((c) => c.tipo === "medida");

  const [tipo, setTipo] = useState<ChartTipo>("line");
  const [xKey, setXKey] = useState<string>(dimensiones[0]?.key ?? "");
  const [seriesKey, setSeriesKey] = useState<string>("");
  const [yKeys, setYKeys] = useState<string[]>(medidas.slice(0, 1).map((m) => m.key));

  // Transformar data para Recharts.
  // - Si seriesKey definida: groupBy x -> { x, [serie1]: y, [serie2]: y, ... }
  // - Si seriesKey vacia: simple { x, [medida1]: y, [medida2]: y, ... }
  const chartData: { rows: Record<string, unknown>[]; series: string[] } = useMemo(() => {
    if (!xKey || yKeys.length === 0) return { rows: [], series: [] };
    if (seriesKey) {
      const yKey = yKeys[0] ?? ""; // con series_by usamos solo 1 medida
      const map = new Map<string, Record<string, unknown>>();
      const seriesSet = new Set<string>();
      for (const fila of resultado.filas) {
        const x = String(fila[xKey] ?? "");
        const s = String(fila[seriesKey] ?? "");
        seriesSet.add(s);
        const existing = map.get(x) ?? { __x: x };
        existing[s] = Number(fila[yKey]);
        map.set(x, existing);
      }
      const dataArr = [...map.values()].sort((a, b) =>
        String(a.__x).localeCompare(String(b.__x)),
      );
      return { rows: dataArr, series: [...seriesSet].sort() };
    }
    const map = new Map<string, Record<string, unknown>>();
    for (const fila of resultado.filas) {
      const x = String(fila[xKey] ?? "");
      const existing = map.get(x) ?? { __x: x };
      for (const yk of yKeys) {
        existing[yk] = Number(fila[yk]);
      }
      map.set(x, existing);
    }
    const dataArr = [...map.values()].sort((a, b) =>
      String(a.__x).localeCompare(String(b.__x)),
    );
    return { rows: dataArr, series: yKeys };
  }, [resultado, xKey, seriesKey, yKeys]);

  const ChartComponent = tipo === "line" ? LineChart : BarChart;

  return (
    <aside className="w-[420px] border-l border-slate-200 bg-white flex flex-col h-full">
      <header className="h-12 border-b border-slate-200 px-3 flex items-center justify-between bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-900">Visualizacion</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="p-3 border-b border-slate-200 space-y-3">
        <div className="flex gap-1">
          <ChartTypeButton
            active={tipo === "line"}
            onClick={() => setTipo("line")}
            icon={<LineIcon className="w-3.5 h-3.5" />}
            label="Linea"
          />
          <ChartTypeButton
            active={tipo === "bar"}
            onClick={() => setTipo("bar")}
            icon={<BarChart3 className="w-3.5 h-3.5" />}
            label="Barra"
          />
        </div>

        <Field label="Eje X (dimension)">
          <select
            value={xKey}
            onChange={(e) => setXKey(e.target.value)}
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            {dimensiones.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Series (opcional)">
          <select
            value={seriesKey}
            onChange={(e) => setSeriesKey(e.target.value)}
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            <option value="">(ninguna)</option>
            {dimensiones
              .filter((d) => d.key !== xKey)
              .map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
          </select>
        </Field>

        <Field label={seriesKey ? "Medida (1)" : "Medidas"}>
          <div className="max-h-40 overflow-y-auto border border-slate-200 rounded bg-slate-50">
            {medidas.map((m) => {
              const checked = yKeys.includes(m.key);
              return (
                <label
                  key={m.key}
                  className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-white"
                >
                  <input
                    type={seriesKey ? "radio" : "checkbox"}
                    checked={checked}
                    onChange={() => {
                      if (seriesKey) {
                        setYKeys([m.key]);
                      } else {
                        setYKeys((prev) =>
                          prev.includes(m.key)
                            ? prev.filter((k) => k !== m.key)
                            : [...prev, m.key],
                        );
                      }
                    }}
                    className="w-3 h-3"
                  />
                  <span className="truncate">{m.label}</span>
                </label>
              );
            })}
          </div>
        </Field>
      </div>

      <div className="flex-1 p-3 min-h-0">
        {chartData.rows.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ChartComponent data={chartData.rows} margin={{ top: 5, right: 10, bottom: 30, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="__x"
                tick={{ fontSize: 10, fill: "#64748b" }}
                angle={-30}
                textAnchor="end"
                height={45}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => formatNumberCompact(Number(v))}
              />
              <Tooltip
                formatter={(v: unknown) => formatNumberCompact(Number(v))}
                contentStyle={{ fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {chartData.series.map((s: string, idx: number) =>
                tipo === "line" ? (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    stroke={PALETA[idx % PALETA.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                ) : (
                  <Bar key={s} dataKey={s} fill={PALETA[idx % PALETA.length]} />
                ),
              )}
            </ChartComponent>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-slate-500 text-center px-4">
            Selecciona eje X y al menos una medida para visualizar.
          </div>
        )}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChartTypeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 h-8 inline-flex items-center justify-center gap-1 text-xs rounded border transition-colors",
        active
          ? "bg-brand-600 text-white border-brand-600"
          : "bg-white text-slate-600 border-slate-300 hover:border-slate-400",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
