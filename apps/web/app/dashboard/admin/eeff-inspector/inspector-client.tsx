"use client";

/**
 * Client component del EEFF Inspector — selectores + 2 tablas (BG y ER) +
 * 3 columnas monedas (MN/ME/TOTAL) + export CSV + extras + quality summary.
 */

import { AlertTriangle, Download, ExternalLink, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { EeffInspectorData, EeffRow, EntidadOption } from "@/lib/domains/pipeline";

export function EeffInspectorClient({
  periodos,
  entidades,
  currentPeriodo,
  currentEntidad,
  data,
}: {
  periodos: number[];
  entidades: EntidadOption[];
  currentPeriodo: number;
  currentEntidad: string;
  data: EeffInspectorData | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = (newParams: Partial<{ entidad: string; periodo: number }>) => {
    const params = new URLSearchParams();
    params.set("entidad", newParams.entidad ?? currentEntidad);
    params.set("periodo", String(newParams.periodo ?? currentPeriodo));
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
        {data && (
          <button
            onClick={() => downloadCsv(data)}
            className="ml-auto px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1"
            type="button"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </button>
        )}
        {data?.periodoPrevio != null && (
          <div className="text-[11px] text-slate-500">
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
          <QualitySummaryRow data={data} />
          <EeffTable
            title="Balance General"
            rows={data.balance}
            extras={data.extrasBalance}
            periodoActual={data.periodo}
            periodoPrevio={data.periodoPrevio}
          />
          <EeffTable
            title="Estado de Resultados (PyG)"
            rows={data.resultados}
            extras={data.extrasResultados}
            periodoActual={data.periodo}
            periodoPrevio={data.periodoPrevio}
          />
          {data.archivos.length > 0 && (
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                <FileText className="w-4 h-4" /> Archivos SBS de este periodo
              </h3>
              <ul className="space-y-1 text-xs">
                {data.archivos.map((a, i) => (
                  <li key={i} className="font-mono text-slate-600">
                    <span className="font-semibold text-slate-800">{a.topico}</span>: {a.pathLocal}{" "}
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
        const bg =
          it.critical > 0
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
              <th rowSpan={2} className="text-right p-2 font-semibold text-slate-700 w-12 border-r">
                #
              </th>
              <th rowSpan={2} className="text-left p-2 font-semibold text-slate-700 w-20 border-r">
                Código
              </th>
              <th rowSpan={2} className="text-left p-2 font-semibold text-slate-700 border-r">
                Cuenta (cabecera-base)
              </th>
              <th
                colSpan={3}
                className="text-center p-1 font-semibold text-slate-700 border-r bg-slate-200 text-[11px]"
              >
                Extraído ({periodoActual})
              </th>
              <th
                colSpan={4}
                className="text-center p-1 font-semibold text-slate-600 border-r bg-amber-50 text-[11px]"
                title="Valores leídos directamente del .xls SBS para verificar que la extracción no perdió data"
              >
                Excel SBS (crudo)
              </th>
              <th rowSpan={2} className="text-right p-2 font-semibold text-slate-700 w-24 border-r">
                Total {periodoPrevio ?? "Previo"}
              </th>
              <th rowSpan={2} className="text-right p-2 font-semibold text-slate-700 w-16 border-r">
                Δ%
              </th>
              <th rowSpan={2} className="text-left p-2 font-semibold text-slate-700 w-24">
                Diag.
              </th>
            </tr>
            <tr className="bg-slate-100 border-b">
              <th className="text-right p-1 font-semibold text-slate-600 w-20 text-[10px]">MN</th>
              <th className="text-right p-1 font-semibold text-slate-600 w-20 text-[10px]">ME</th>
              <th className="text-right p-1 font-semibold text-slate-700 w-24 text-[11px] bg-slate-50 border-r">
                TOTAL
              </th>
              <th className="text-right p-1 font-semibold text-amber-800 w-20 text-[10px] bg-amber-50">
                MN
              </th>
              <th className="text-right p-1 font-semibold text-amber-800 w-20 text-[10px] bg-amber-50">
                ME
              </th>
              <th className="text-right p-1 font-semibold text-amber-900 w-24 text-[11px] bg-amber-50">
                TOTAL
              </th>
              <th
                className="text-right p-1 font-semibold text-amber-900 w-16 text-[10px] bg-amber-50 border-r"
                title="Diferencia entre TOTAL extraído y TOTAL del archivo. Si != 0, el parser perdió o agregó data."
              >
                Δ
              </th>
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
            El parser persistió estas filas en raw.eeff_observacion pero la cabecera-base no las
            define. Posible drift de SBS — revisar si hay que actualizar la cabecera.
          </p>
          <table className="text-xs mt-2 w-full">
            <thead>
              <tr className="text-amber-900">
                <th className="text-left p-1">Código</th>
                <th className="text-left p-1">Nombre en archivo</th>
                <th className="text-right p-1 w-20">MN</th>
                <th className="text-right p-1 w-20">ME</th>
                <th className="text-right p-1 w-24">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {extras.map((e) => (
                <tr key={e.cuentaCodigo} className="border-t border-amber-200">
                  <td className="p-1 font-mono">{e.cuentaCodigo}</td>
                  <td className="p-1">{e.cuentaNombre}</td>
                  <td className="p-1 text-right font-mono">{fmt(e.valorMN)}</td>
                  <td className="p-1 text-right font-mono">{fmt(e.valorME)}</td>
                  <td className="p-1 text-right font-mono font-semibold">{fmt(e.valorTotal)}</td>
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
  const isSection = row.esSeccion;
  const isHeader = row.esHeader;
  const isTotal = row.esTotal;
  const indent = row.nivel * 12;

  let rowClass = "border-b border-slate-100 hover:bg-slate-50";
  const codigoClass = "font-mono text-slate-600";
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

  const diag: string[] = [];
  if (row.faltaEnRaw) diag.push("❌ falta");
  if (row.nombreMismatch) diag.push("⚠️ nombre");
  if (row.diffTotal != null) diag.push("🔴 diff");
  if (row.qualityStatus === "critical") diag.push("🚨");
  else if (row.qualityStatus === "warning") diag.push("⚠️");

  return (
    <tr className={rowClass}>
      <td className="p-2 text-right text-slate-400 border-r">{row.orden}</td>
      <td className={`p-2 border-r ${codigoClass}`}>{row.cuentaCodigo ?? "—"}</td>
      <td className={`p-2 border-r ${nombreClass}`} style={{ paddingLeft: 8 + indent }}>
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
      <td className="p-2 text-right font-mono text-slate-600">{fmt(row.valorMN)}</td>
      <td className="p-2 text-right font-mono text-slate-600">{fmt(row.valorME)}</td>
      <td className="p-2 text-right font-mono font-semibold bg-slate-50 border-r">
        {fmt(row.valorTotal)}
      </td>
      <td className="p-2 text-right font-mono text-amber-700 bg-amber-50/50">
        {fmt(row.xlsValorMN)}
      </td>
      <td className="p-2 text-right font-mono text-amber-700 bg-amber-50/50">
        {fmt(row.xlsValorME)}
      </td>
      <td className="p-2 text-right font-mono font-semibold text-amber-900 bg-amber-50">
        {fmt(row.xlsValorTotal)}
      </td>
      <td
        className={`p-2 text-right font-mono text-[11px] border-r ${
          row.diffTotal == null
            ? "bg-amber-50 text-amber-400"
            : "bg-red-100 text-red-800 font-semibold"
        }`}
        title={
          row.diffTotal == null ? "Coincide" : `Extraído - Crudo = ${row.diffTotal.toFixed(4)}`
        }
      >
        {row.diffTotal == null ? "—" : fmt(row.diffTotal)}
      </td>
      <td className="p-2 text-right font-mono text-slate-500 border-r">{fmt(row.valorPrev)}</td>
      <td
        className={`p-2 text-right font-mono border-r ${
          row.deltaPct == null ? "" : row.deltaPct > 0 ? "text-emerald-700" : "text-red-700"
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

/* ──────────────────────────────────────────────────────────────────────── */
/* Export CSV                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

function downloadCsv(data: EeffInspectorData): void {
  const lines: string[] = [];
  // Header
  lines.push(
    [
      "Seccion",
      "Orden",
      "Codigo",
      "Nombre (cabecera-base)",
      "Nombre (archivo SBS)",
      "Nivel",
      "es_header",
      "es_total",
      "es_seccion",
      "Valor MN",
      "Valor ME",
      `Valor TOTAL ${data.periodo}`,
      "Excel SBS MN",
      "Excel SBS ME",
      "Excel SBS TOTAL",
      "Diff TOTAL (extraido - crudo)",
      `Valor TOTAL ${data.periodoPrevio ?? "Previo"}`,
      "Delta abs",
      "Delta pct",
      "Quality status",
      "Falta en raw",
      "Nombre mismatch",
    ]
      .map(csvEscape)
      .join(","),
  );

  const dump = (seccion: string, rows: EeffRow[]) => {
    for (const r of rows) {
      lines.push(
        [
          seccion,
          String(r.orden),
          r.cuentaCodigo ?? "",
          r.cuentaNombreCanonica,
          r.cuentaNombreArchivo ?? "",
          String(r.nivel),
          String(r.esHeader),
          String(r.esTotal),
          String(r.esSeccion),
          r.valorMN != null ? String(r.valorMN) : "",
          r.valorME != null ? String(r.valorME) : "",
          r.valorTotal != null ? String(r.valorTotal) : "",
          r.xlsValorMN != null ? String(r.xlsValorMN) : "",
          r.xlsValorME != null ? String(r.xlsValorME) : "",
          r.xlsValorTotal != null ? String(r.xlsValorTotal) : "",
          r.diffTotal != null ? String(r.diffTotal) : "",
          r.valorPrev != null ? String(r.valorPrev) : "",
          r.deltaAbs != null ? String(r.deltaAbs) : "",
          r.deltaPct != null ? String(r.deltaPct) : "",
          r.qualityStatus,
          String(r.faltaEnRaw),
          String(r.nombreMismatch),
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  };

  dump("BALANCE", data.balance);
  dump("RESULTADOS", data.resultados);

  // Extras
  if (data.extrasBalance.length > 0 || data.extrasResultados.length > 0) {
    lines.push("");
    lines.push("# EXTRAS (filas en raw fuera de cabecera-base)");
    lines.push(
      ["Seccion", "Codigo", "Nombre archivo", "MN", "ME", "TOTAL"].map(csvEscape).join(","),
    );
    for (const e of data.extrasBalance) {
      lines.push(
        [
          "BALANCE_EXTRA",
          e.cuentaCodigo,
          e.cuentaNombre,
          e.valorMN != null ? String(e.valorMN) : "",
          e.valorME != null ? String(e.valorME) : "",
          e.valorTotal != null ? String(e.valorTotal) : "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    for (const e of data.extrasResultados) {
      lines.push(
        [
          "RESULTADOS_EXTRA",
          e.cuentaCodigo,
          e.cuentaNombre,
          e.valorMN != null ? String(e.valorMN) : "",
          e.valorME != null ? String(e.valorME) : "",
          e.valorTotal != null ? String(e.valorTotal) : "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }

  const csv = lines.join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eeff_${slug(data.entidad)}_${data.periodo}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
