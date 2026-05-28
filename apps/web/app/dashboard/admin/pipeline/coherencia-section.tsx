"use client";

/**
 * Sección 6 — Coherencia de datos (V2 Data Quality, issue #24).
 *
 * Muestra los chequeos automáticos de coherencia semántica de los EEFF:
 *   - balance_contable: Activos = Pasivos + Patrimonio (BANCOS + FIN)
 *   - outlier_zscore:   valor actual vs media+stddev 11m previos
 *   - suma_subcuentas:  padre = SUM(hijos directos)
 *
 * Layout: 3 tarjetas con counts por check_type + tabla expandible con
 * detalle por anomalía + botones de review.
 */

import { useState } from "react";

import type { QualityCheckRow, QualitySummary } from "@/lib/domains/pipeline";

const CHECK_LABELS: Record<string, string> = {
  balance_contable: "Balance contable",
  outlier_zscore: "Outliers (z-score)",
  suma_subcuentas: "Suma subcuentas",
};

const CHECK_DESCRIPTION: Record<string, string> = {
  balance_contable: "Activos = Pasivos + Patrimonio (BANCOS + FIN)",
  outlier_zscore: "Valor actual vs media+stddev 11m previos",
  suma_subcuentas: "Padre = SUM(hijos directos)",
};

const SEVERITY_BG: Record<string, string> = {
  ok: "bg-emerald-50 border-emerald-300 text-emerald-900",
  warning: "bg-amber-50 border-amber-300 text-amber-900",
  critical: "bg-red-50 border-red-300 text-red-900",
};

const REVIEW_ACTIONS = [
  { value: "fixed", label: "Arreglado" },
  { value: "falsa_alarma", label: "Falsa alarma" },
  { value: "sbs_publishing_quirk", label: "Quirk SBS" },
  { value: "ignored", label: "Ignorar" },
  { value: "otro", label: "Otro" },
];

export function CoherenciaSection({
  summary,
  rows,
}: {
  summary: QualitySummary;
  rows: QualityCheckRow[];
}) {
  if (summary.periodo === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
        Sin quality checks corridos aún. Corré <code>aibenchef pipeline quality-check</code> tras
        el próximo import.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* 3 tarjetas summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {["balance_contable", "outlier_zscore", "suma_subcuentas"].map((checkType) => {
          const row = summary.byCheckType.find((r) => r.checkType === checkType);
          const critical = row?.critical ?? 0;
          const warning = row?.warning ?? 0;
          const bg = critical > 0 ? SEVERITY_BG.critical : warning > 0 ? SEVERITY_BG.warning : SEVERITY_BG.ok;
          const icon = critical > 0 ? "🚨" : warning > 0 ? "⚠️" : "✅";
          return (
            <div key={checkType} className={`rounded-lg border p-3 ${bg}`}>
              <div className="text-[10px] uppercase tracking-wide font-semibold opacity-75">
                {CHECK_LABELS[checkType]}
              </div>
              <div className="text-2xl font-bold mt-1 flex items-center gap-2">
                <span>{icon}</span>
                <span>
                  {critical}/<span className="opacity-50">{warning + critical}</span>
                </span>
              </div>
              <div className="text-[11px] mt-1 opacity-75">
                {critical} critical · {warning} warning
              </div>
              <div className="text-[10px] mt-1 italic opacity-60">
                {CHECK_DESCRIPTION[checkType]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabla detalle */}
      {rows.length === 0 ? (
        <p className="text-sm text-emerald-700">
          ✅ Sin anomalías sin revisar para periodo {summary.periodo}.
        </p>
      ) : (
        <QualityChecksTable rows={rows} />
      )}
    </div>
  );
}

function QualityChecksTable({ rows }: { rows: QualityCheckRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr className="bg-slate-50 border-b">
            <th className="text-left p-2 font-semibold text-slate-700">Entidad</th>
            <th className="text-left p-2 font-semibold text-slate-700">Check</th>
            <th className="text-left p-2 font-semibold text-slate-700">Cuenta</th>
            <th className="text-right p-2 font-semibold text-slate-700">Esperado</th>
            <th className="text-right p-2 font-semibold text-slate-700">Real</th>
            <th className="text-right p-2 font-semibold text-slate-700">Δ%</th>
            <th className="text-right p-2 font-semibold text-slate-700">z-score</th>
            <th className="text-center p-2 font-semibold text-slate-700">Sev.</th>
            <th className="text-left p-2 font-semibold text-slate-700">Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <QualityCheckRowComponent key={row.id} row={row} />)}
        </tbody>
      </table>
    </div>
  );
}

function QualityCheckRowComponent({ row }: { row: QualityCheckRow }) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleReview(action: string) {
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/pipeline/quality/${row.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setReviewed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }

  if (reviewed) {
    return (
      <tr className="border-b bg-emerald-50">
        <td colSpan={9} className="p-2 text-emerald-700 text-center">
          ✓ Marcado como revisado
        </td>
      </tr>
    );
  }

  const sevBg =
    row.status === "critical"
      ? "bg-red-100 text-red-800"
      : row.status === "warning"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";

  return (
    <>
      <tr className="border-b hover:bg-slate-50">
        <td className="p-2 font-semibold text-slate-800">{row.nombCorreg}</td>
        <td className="p-2 text-slate-700">{CHECK_LABELS[row.checkType] ?? row.checkType}</td>
        <td className="p-2 font-mono text-slate-600">{row.cuentaCodigo ?? "—"}</td>
        <td className="p-2 text-right font-mono">{fmtN(row.expectedValue)}</td>
        <td className="p-2 text-right font-mono">{fmtN(row.actualValue)}</td>
        <td className="p-2 text-right font-mono">{fmtPct(row.deltaPct)}</td>
        <td className="p-2 text-right font-mono">{row.zScore != null ? row.zScore.toFixed(2) : "—"}</td>
        <td className="p-2 text-center">
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${sevBg}`}>
            {row.status}
          </span>
        </td>
        <td className="p-2">
          <div className="flex items-center gap-1 flex-wrap">
            {Object.keys(row.payload).length > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] text-sky-700 hover:underline"
                type="button"
              >
                {expanded ? "Ocultar" : "Detalle"}
              </button>
            )}
            {REVIEW_ACTIONS.map((act) => (
              <button
                key={act.value}
                onClick={() => handleReview(act.value)}
                disabled={reviewing}
                className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                type="button"
              >
                {act.label}
              </button>
            ))}
          </div>
          {error && <div className="text-red-600 text-[11px] mt-1">{error}</div>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-slate-50">
          <td colSpan={9} className="p-3">
            <pre className="text-[10px] overflow-x-auto bg-white border border-slate-200 rounded p-2 font-mono">
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function fmtN(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(2);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(2) + "%";
}
