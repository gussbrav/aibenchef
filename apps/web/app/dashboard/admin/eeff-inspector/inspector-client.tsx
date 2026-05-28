"use client";

/**
 * Client component del EEFF Inspector — selectores + 2 tablas (BG y ER) +
 * extras + quality summary.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, ExternalLink, FileText } from "lucide-react";

import type {
  EeffInspectorData,
  EeffRow,
  EntidadOption,
  Moneda,
} from "@/lib/domains/pipeline";

const MONEDAS: { value: Moneda; label: string }[] = [
  { value: "TOTAL", label: "Total (MN+ME)" },
  { value: "MN", label: "Moneda Nacional" },
  { value: "ME", label: "Moneda Extranjera" },
];

export function EeffInspectorClient({
  periodos,
  entidades,
  currentPeriodo,
  currentEntidad,
  currentMoneda,
  data,
}: {
  periodos: number[];
  entidades: EntidadOption[];
  currentPeriodo: number;
  currentEntidad: string;
  currentMoneda: Moneda;
  data: EeffInspectorData | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = (newParams: Partial<{ entidad: string; periodo: number; moneda: Moneda }>) => {
    const params = new URLSearchParams();
    params.set("entidad", newParams.entidad ?? currentEntidad);
    params.set("periodo", String(newParams.periodo ?? currentPeriodo));
    params.set("moneda", newParams.moneda ?? currentMoneda);
    startTransition(() => {
      router.push(`/dashboard/admin/eeff-inspector?${params}` as never);
    });
  };

  return (
    <div className={`space-y-6 ${isPending ? "opacity-60" : ""}`}>
      {/* Selectores */}
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
        <SelectField
          label="Entidad"
          value={currentEntidad}
          onChange={(v) => navigate({ entidad: v })}
          options={entidades.map((e) => ({
            value: e.nombCorreg,
            label: `${e.tipoEntidad} — ${e.nombCorreg}`,
          }))}
          className="min-w-[280px]"
        />
        <SelectField
          label="Periodo"
          value={String(currentPeriodo)}
          onChange={(v) => navigate({ periodo: Number(v) })}
          options={periodos.map((p) => ({ value: String(p), label: formatPeriodo(p) }))}
        />
        <SelectField
          label="Moneda"
          value={currentMoneda}
          onChange={(v) => navigate({ moneda: v as Moneda })}
          options={MONEDAS.map((m) => ({ value: m.value, label: m.label }))}
        />
        {data?.periodoPrevio != null && (
          <div className="text-[11px] text-slate-500 ml-auto">
            Periodo previo: <code className="font-mono">{data.periodoPrevio}</code>
          </div>
        )}
      </div>

      {!data ? (
        <p className="text-sm text-slate-500 italic">
          Sin data para {currentEntidad} en periodo {currentPeriodo}.
        </p>
      ) : (
        <>
          {/* Quality summary cards */}
          <QualitySummaryRow data={data} />

          {/* Tabla Balance General */}
          <EeffTable
            title="Balance General"
            rows={data.balance}
            extras={data.extrasBalance}
            periodoActual={data.periodo}
            periodoPrevio={data.periodoPrevio}
          />

          {/* Tabla Estado de Resultados */}
          <EeffTable
            title="Estado de Resultados (PyG)"
            rows={data.resultados}
            extras={data.extrasResultados}
            periodoActual={data.periodo}
            periodoPrevio={data.periodoPrevio}
          />

          {/* Archivos descargados */}
          {data.archivos.length > 0 && (
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                <FileText className="w-4 h-4" /> Archivos SBS de este periodo
              </h3>
              <ul className="space-y-1 text-xs">
                {data.archivos.map((a, i) => (
                  <li key={i} className="font-mono text-slate-600">
                    <span className="font-semibold text-slate-800">{a.topico}</span>:{" "}
                    {a.pathLocal}{" "}
                    <a
                      href={a.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-700 hover:underline inline-flex items-center gap-0.5 ml-1"
                    >
                      <ExternalLink className="w-3 h-3" /> SBS
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function QualitySummaryRow({ data }: { data: EeffInspectorData }) {
  const items = [
    { label: "Balance contable", ...data.qualitySummary.balance },
    { label: "Outliers", ...data.qualitySummary.outliers },
    { label: "Suma subcuentas", ...data.qualitySummary.subcuentas },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {items.map((it) => {
        const bg = it.critical > 0
          ? "bg-red-50 border-red-300 text-red-900"
          : it.warning > 0
            ? "bg-amber-50 border-amber-300 text-amber-900"
            : "bg-emerald-50 border-emerald-300 text-emerald-900";
        const icon = it.critical > 0 ? "🚨" : it.warning > 0 ? "⚠️" : "✅";
        return (
          <div key={it.label} className={`rounded-lg border p-3 ${bg}`}>
            <div className="text-[10px] uppercase tracking-wide font-semibold opacity-75">
              {it.label}
            </div>
            <div className="text-xl font-bold mt-1 flex items-center gap-2">
              <span>{icon}</span>
              <span>
                {it.critical} critical · {it.warning} warning
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EeffTable({
  title,
  rows,
  extras,
  periodoActual,
  periodoPrevio,
}: {
  title: string;
  rows: EeffRow[];
  extras: EeffInspectorData["extrasBalance"];
  periodoActual: number;
  periodoPrevio: number | null;
}) {
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500 italic mt-2">
          Sin cabecera definida para esta entidad/estado.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="bg-slate-100 border-b">
              <th className="text-right p-2 font-semibold text-slate-700 w-12">#</th>
              <th className="text-left p-2 font-semibold text-slate-700 w-20">Código</th>
              <th className="text-left p-2 font-semibold text-slate-700">
                Cuenta (cabecera-base)
              </th>
              <th className="text-right p-2 font-semibold text-slate-700 w-32">
                Valor {periodoActual}
              </th>
              <th className="text-right p-2 font-semibold text-slate-700 w-32">
                {periodoPrevio ?? "Previo"}
              </th>
              <th className="text-right p-2 font-semibold text-slate-700 w-20">Δ%</th>
              <th className="text-left p-2 font-semibold text-slate-700 w-32">Diag.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <EeffRowComponent key={`${r.orden}-${r.cuentaCodigo ?? "noc"}`} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      {extras.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 mt-3">
          <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {extras.length} cuentas extra en archivo que NO están en cabecera-base
          </h3>
          <p className="text-[11px] text-amber-800 mt-1">
            El parser persistió estas filas en raw.eeff_observacion pero la cabecera-base
            no las define. Posible drift de SBS — revisar si hay que actualizar la cabecera.
          </p>
          <table className="text-xs mt-2 w-full">
            <thead>
              <tr className="text-amber-900">
                <th className="text-left p-1">Código</th>
                <th className="text-left p-1">Nombre en archivo</th>
                <th className="text-right p-1">Valor</th>
              </tr>
            </thead>
            <tbody>
              {extras.map((e) => (
                <tr key={e.cuentaCodigo} className="border-t border-amber-200">
                  <td className="p-1 font-mono">{e.cuentaCodigo}</td>
                  <td className="p-1">{e.cuentaNombre}</td>
                  <td className="p-1 text-right font-mono">{fmt(e.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EeffRowComponent({ row }: { row: EeffRow }) {
  // Estilo según tipo de fila
  const isSection = row.esSeccion;
  const isHeader = row.esHeader;
  const isTotal = row.esTotal;
  const indent = row.nivel * 12;

  let rowClass = "border-b border-slate-100 hover:bg-slate-50";
  let codigoClass = "font-mono text-slate-600";
  let nombreClass = "text-slate-800";

  if (isSection) {
    rowClass += " bg-slate-200 font-bold uppercase tracking-wide";
    nombreClass = "text-slate-900 font-bold";
  } else if (isTotal) {
    rowClass += " bg-blue-50 font-semibold";
    nombreClass = "text-blue-900 font-semibold";
  } else if (isHeader) {
    rowClass += " bg-slate-50";
    nombreClass = "text-slate-900 font-semibold";
  }

  // Indicador de issue
  const diag: string[] = [];
  if (row.faltaEnRaw) diag.push("❌ falta");
  if (row.nombreMismatch) diag.push("⚠️ nombre");
  if (row.qualityStatus === "critical") diag.push("🚨");
  else if (row.qualityStatus === "warning") diag.push("⚠️");

  return (
    <tr className={rowClass}>
      <td className="p-2 text-right text-slate-400">{row.orden}</td>
      <td className={`p-2 ${codigoClass}`}>{row.cuentaCodigo ?? "—"}</td>
      <td className={`p-2 ${nombreClass}`} style={{ paddingLeft: 8 + indent }}>
        <span>{row.cuentaNombreCanonica}</span>
        {row.nombreMismatch && row.cuentaNombreArchivo && (
          <span
            className="ml-2 text-[10px] text-amber-700"
            title={`SBS: "${row.cuentaNombreArchivo}"`}
          >
            (SBS: {row.cuentaNombreArchivo.slice(0, 40)}
            {row.cuentaNombreArchivo.length > 40 ? "…" : ""})
          </span>
        )}
      </td>
      <td className="p-2 text-right font-mono">{fmt(row.valor)}</td>
      <td className="p-2 text-right font-mono text-slate-500">{fmt(row.valorPrev)}</td>
      <td
        className={`p-2 text-right font-mono ${
          row.deltaPct == null
            ? ""
            : row.deltaPct > 0
              ? "text-emerald-700"
              : "text-red-700"
        }`}
      >
        {fmtPct(row.deltaPct)}
      </td>
      <td className="p-2 text-[11px]">{diag.join(" ")}</td>
    </tr>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(2);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function formatPeriodo(p: number): string {
  const y = Math.floor(p / 100);
  const m = p % 100;
  return `${y}-${String(m).padStart(2, "0")}`;
}
