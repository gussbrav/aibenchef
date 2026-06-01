"use client";

/**
 * SeccionHistoricoComparativo — componente reusable para las secciones
 * tipo "PowerPoint" del benchmark donde el patron es:
 *
 *   Izquierda: bar comparativo (valor actual + base + variacion absoluta).
 *   Derecha:   grid de mini bar charts por entidad mostrando la serie
 *              historica de los ultimos N periodos.
 *
 * Inspirado en el layout estandar de informes ejecutivos del sistema
 * financiero peruano (Caja Arequipa, BCP, etc.), pero con UI propia
 * (recharts, sin copiar iconos ni branding de PowerPoint).
 */

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HistoricoEntidadSerie } from "@/lib/domains/informe/types";

const fmtNum = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(n);
};

const fmtSigno = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtNum(n)}`;
};

export function SeccionHistoricoComparativo({
  titulo,
  subtitulo,
  series,
  periodoBaseLabel,
  periodoActualLabel,
  comentario,
  formatoValor = "numero",
}: {
  /** Titulo grande del header (ej "N° de Oficinas"). */
  titulo: string;
  /** Subtitulo / contexto (ej "Principales competidores"). */
  subtitulo?: string;
  /** Una entrada por competidor con su serie. */
  series: HistoricoEntidadSerie[];
  /** Label del primer periodo de la serie (para "X vs Y"). */
  periodoBaseLabel?: string;
  /** Label del ultimo periodo de la serie. */
  periodoActualLabel?: string;
  /** Texto opcional con insight al pie. */
  comentario?: string;
  /** numero: formato entero. pct: formato % con 2 decimales. */
  formatoValor?: "numero" | "pct";
}) {
  if (!series || series.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-2">{titulo}</h2>
        <p className="text-sm text-slate-500">Sin datos para el peer group actual.</p>
      </section>
    );
  }

  const periodoLabelRango =
    periodoBaseLabel && periodoActualLabel
      ? `${periodoBaseLabel} – ${periodoActualLabel}`
      : "";

  const formatValor = (v: number | null) => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (formatoValor === "pct") {
      return `${(v * 100).toFixed(2)}%`;
    }
    return fmtNum(v);
  };

  // Para el bar comparativo izquierda — ordenar por valor actual desc
  const sorted = [...series].sort(
    (a, b) => (b.valorActual ?? -Infinity) - (a.valorActual ?? -Infinity),
  );

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-5 py-3 bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        <h2 className="text-base font-bold tracking-wide">{titulo}</h2>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 p-5">
        {/* Panel izquierdo: comparativo Base → Actual */}
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{titulo}</h3>
            {subtitulo && <p className="text-xs text-slate-500">{subtitulo}</p>}
            {periodoLabelRango && (
              <p className="text-xs font-mono text-slate-500 mt-1">{periodoLabelRango}</p>
            )}
          </div>
          <div className="space-y-2">
            {sorted.map((s) => {
              const vMax = Math.max(
                ...sorted.map((x) => x.valorActual ?? 0),
                1,
              );
              const widthPct = ((s.valorActual ?? 0) / vMax) * 100;
              const widthBasePct = ((s.valorBase ?? 0) / vMax) * 100;
              const variacion = s.variacionTotal;
              const variacionPositiva = (variacion ?? 0) >= 0;
              return (
                <div key={s.entidad} className="text-xs">
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="font-semibold text-slate-700 truncate max-w-[140px]">
                      {s.entidad}
                    </span>
                    <span className="font-mono text-slate-500">
                      {formatValor(s.valorActual)}
                    </span>
                  </div>
                  <div className="relative h-4 bg-slate-100 rounded">
                    {/* Barra base (mas claro) */}
                    <div
                      className="absolute top-0 bottom-0 left-0 rounded bg-slate-300 opacity-40"
                      style={{ width: `${widthBasePct}%` }}
                      title={`Base ${periodoBaseLabel ?? ""}: ${formatValor(s.valorBase)}`}
                    />
                    {/* Barra actual (color de la entidad) */}
                    <div
                      className="absolute top-0 bottom-0 left-0 rounded transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: s.color }}
                    />
                  </div>
                  {variacion != null && (
                    <p
                      className={`text-[10px] mt-0.5 font-semibold ${
                        variacionPositiva ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {variacionPositiva ? "△" : "▽"} {fmtSigno(variacion)}{" "}
                      {formatoValor === "pct" ? "pp" : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel derecho: grid 3x2 de mini bar charts por entidad */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 text-center">
            Tendencia por entidad
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {series.map((s) => (
              <MiniBarChart key={s.entidad} serie={s} formatoValor={formatoValor} />
            ))}
          </div>
        </div>
      </div>
      {comentario && (
        <div className="px-5 pb-5">
          <p className="text-xs text-slate-600 italic bg-slate-50 border border-slate-100 rounded p-3">
            {comentario}
          </p>
        </div>
      )}
    </section>
  );
}

function MiniBarChart({
  serie,
  formatoValor,
}: {
  serie: HistoricoEntidadSerie;
  formatoValor: "numero" | "pct";
}) {
  const data = serie.serie.map((p) => ({
    name: p.periodoLabel,
    valor: p.valor ?? 0,
    rawValor: p.valor,
  }));

  const fmtLabel = (v: number) =>
    formatoValor === "pct" ? `${(v * 100).toFixed(1)}%` : fmtNum(v);

  return (
    <div className="border border-slate-200 rounded p-2 bg-white">
      <p className="text-xs font-semibold text-slate-700 truncate text-center mb-1">
        {serie.entidad}
      </p>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis hide />
            <Tooltip
              formatter={(v: number) => fmtLabel(v)}
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              contentStyle={{ fontSize: 11 }}
            />
            <Bar dataKey="valor" radius={[2, 2, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={serie.color} fillOpacity={i === data.length - 1 ? 1 : 0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
