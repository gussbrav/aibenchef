"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber, formatNumberCompact, formatPct } from "@/app/dashboard/_lib/format";

import type { TableroWidget } from "@/lib/domains/tableros";

const PALETA_DEFAULT = [
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

function formatValor(v: unknown, formato?: string, decimales?: number): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (formato === "porcentaje") return formatPct(n, decimales ?? 2);
  if (formato === "moneda") return `S/ ${formatNumberCompact(n)}`;
  return formatNumber(n, decimales ?? 0);
}

type QueryResult = {
  columnas: Array<{ key: string; tipo: string }>;
  filas: Array<Record<string, unknown>>;
};

function useQuery(sql: string | undefined) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sql || !sql.trim()) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/v1/sql/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sqlText: sql }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json.error) setError(json.error.message ?? "Error");
        else setData(json.data as QueryResult);
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sql]);

  return { data, loading, error };
}

export function WidgetRenderer({ widget }: { widget: TableroWidget }) {
  if (widget.tipo === "markdown") {
    return (
      <div className="prose prose-sm max-w-none p-4 overflow-y-auto h-full">
        {widget.titulo && (
          <h3 className="text-base font-semibold text-slate-900 mt-0">{widget.titulo}</h3>
        )}
        <div
          className="text-sm text-slate-700 whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: simpleMarkdown(widget.config.content ?? "") }}
        />
      </div>
    );
  }

  return <DataWidget widget={widget} />;
}

function simpleMarkdown(text: string): string {
  // Markdown ultra-minimal — sin lib externa para evitar bundle
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code class='bg-slate-100 px-1 py-0.5 rounded text-xs'>$1</code>")
    .replace(/\n/g, "<br/>");
}

function DataWidget({ widget }: { widget: TableroWidget }) {
  const { data, loading, error } = useQuery(widget.config.sql);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-slate-500">
        Cargando...
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 text-xs text-rose-700 bg-rose-50 h-full overflow-auto">
        <p className="font-semibold mb-1">Error en el widget</p>
        <p className="font-mono">{error}</p>
      </div>
    );
  }
  if (!data || data.filas.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-slate-400">
        Sin datos
      </div>
    );
  }

  switch (widget.tipo) {
    case "kpi":
      return <KpiContent widget={widget} data={data} />;
    case "chart_line":
      return <LineChartContent widget={widget} data={data} />;
    case "chart_bar":
      return <BarChartContent widget={widget} data={data} />;
    case "chart_area":
      return <AreaChartContent widget={widget} data={data} />;
    case "chart_pie":
      return <PieChartContent widget={widget} data={data} />;
    case "chart_combo":
      return <ComboChartContent widget={widget} data={data} />;
    case "table":
      return <TableContent widget={widget} data={data} />;
    default:
      return null;
  }
}

function KpiContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  const campo = widget.config.campo ?? data.columnas[0]?.key ?? "";
  const valor = data.filas[0]?.[campo];
  return (
    <div className="flex flex-col justify-center h-full p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {widget.config.label ?? widget.titulo ?? campo}
      </p>
      <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">
        {formatValor(valor, widget.config.formato, widget.config.decimales)}
      </p>
    </div>
  );
}

function commonChartData(widget: TableroWidget, data: QueryResult) {
  const xKey = widget.config.xKey ?? data.columnas[0]?.key ?? "";
  const yKeys = widget.config.yKeys ?? [data.columnas[1]?.key ?? ""].filter(Boolean);
  const seriesKey = widget.config.seriesKey;

  if (seriesKey) {
    const yKey = yKeys[0] ?? data.columnas[1]?.key ?? "";
    const map = new Map<string, Record<string, unknown>>();
    const seriesSet = new Set<string>();
    for (const row of data.filas) {
      const x = String(row[xKey] ?? "");
      const s = String(row[seriesKey] ?? "");
      seriesSet.add(s);
      const existing = map.get(x) ?? { __x: x };
      existing[s] = Number(row[yKey]);
      map.set(x, existing);
    }
    return {
      xKey,
      rows: [...map.values()].sort((a, b) =>
        String(a.__x).localeCompare(String(b.__x)),
      ),
      series: [...seriesSet].sort(),
    };
  }
  return {
    xKey,
    rows: data.filas.map((r) => ({ ...r, __x: String(r[xKey] ?? "") })),
    series: yKeys,
  };
}

function commonChartProps(widget: TableroWidget) {
  return {
    paleta: widget.config.paleta ?? PALETA_DEFAULT,
    formato: widget.config.formato,
    decimales: widget.config.decimales,
  };
}

function LineChartContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  const { rows, series } = commonChartData(widget, data);
  const { paleta, formato, decimales } = commonChartProps(widget);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="__x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumberCompact(Number(v))} />
        <Tooltip formatter={(v: unknown) => formatValor(v, formato, decimales)} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {series.map((s, i) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            stroke={paleta[i % paleta.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function BarChartContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  const { rows, series } = commonChartData(widget, data);
  const { paleta, formato, decimales } = commonChartProps(widget);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="__x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumberCompact(Number(v))} />
        <Tooltip formatter={(v: unknown) => formatValor(v, formato, decimales)} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {series.map((s, i) => (
          <Bar key={s} dataKey={s} fill={paleta[i % paleta.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function AreaChartContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  const { rows, series } = commonChartData(widget, data);
  const { paleta, formato, decimales } = commonChartProps(widget);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="__x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumberCompact(Number(v))} />
        <Tooltip formatter={(v: unknown) => formatValor(v, formato, decimales)} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {series.map((s, i) => (
          <Area
            key={s}
            type="monotone"
            dataKey={s}
            stroke={paleta[i % paleta.length]}
            fill={paleta[i % paleta.length]}
            fillOpacity={0.3}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PieChartContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  const xKey = widget.config.xKey ?? data.columnas[0]?.key ?? "";
  const yKey = widget.config.yKeys?.[0] ?? data.columnas[1]?.key ?? "";
  const { paleta, formato, decimales } = commonChartProps(widget);
  const pieData = data.filas.map((r) => ({
    name: String(r[xKey] ?? ""),
    value: Number(r[yKey]),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={pieData} dataKey="value" nameKey="name" outerRadius="75%" label>
          {pieData.map((_, i) => (
            <Cell key={i} fill={paleta[i % paleta.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: unknown) => formatValor(v, formato, decimales)} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ComboChartContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  const xKey = widget.config.xKey ?? data.columnas[0]?.key ?? "";
  const combo = widget.config.combo ?? [];
  const rows = data.filas.map((r) => ({ ...r, __x: String(r[xKey] ?? "") }));
  const paleta = widget.config.paleta ?? PALETA_DEFAULT;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="__x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumberCompact(Number(v))} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {combo.map((c, i) =>
          c.tipo === "bar" ? (
            <Bar key={c.yKey} dataKey={c.yKey} fill={c.color ?? paleta[i % paleta.length]} />
          ) : (
            <Line
              key={c.yKey}
              type="monotone"
              dataKey={c.yKey}
              stroke={c.color ?? paleta[i % paleta.length]}
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          ),
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function TableContent({ widget, data }: { widget: TableroWidget; data: QueryResult }) {
  return (
    <div className="overflow-auto h-full text-xs">
      <table className="w-full">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            {data.columnas.map((c) => (
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
          {data.filas.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {data.columnas.map((c) => {
                const v = row[c.key];
                const isNum = c.tipo === "number";
                return (
                  <td
                    key={c.key}
                    className={`px-2 py-1 whitespace-nowrap ${
                      isNum ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {v === null || v === undefined
                      ? "—"
                      : isNum
                        ? formatValor(v, widget.config.formato, widget.config.decimales)
                        : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
