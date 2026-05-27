"use client";

/**
 * Sección 3 — Anomalías estructurales (admin.estructura_diffs sin revisar).
 *
 * Cada fila muestra (periodo, grupo, topico, tipo_estado, n_renames, n_extras,
 * n_missing, severity) + acciones de review. Expandable para ver payload.
 */

import { useState } from "react";
import type { AnomaliaRow } from "@/lib/domains/pipeline";

const SEVERITY_BG: Record<AnomaliaRow["severity"], string> = {
  info: "bg-slate-100 text-slate-700",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

const SEVERITY_ICON: Record<AnomaliaRow["severity"], string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

const REVIEW_ACTIONS: { value: string; label: string }[] = [
  { value: "ignored", label: "Ignorar" },
  { value: "cabecera_updated", label: "Actualicé cabecera" },
  { value: "rename_added", label: "Agregué rename" },
  { value: "falsa_alarma", label: "Falsa alarma" },
  { value: "otro", label: "Otro" },
];

export function AnomaliasTable({ anomalias }: { anomalias: AnomaliaRow[] }) {
  if (anomalias.length === 0) {
    return (
      <p className="text-sm text-emerald-700">
        ✅ Sin anomalías sin revisar. Estructura SBS alinea con cabecera_maestra.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr className="bg-slate-50 border-b">
            <th className="text-left p-2 font-semibold text-slate-700">Periodo</th>
            <th className="text-left p-2 font-semibold text-slate-700">Grupo</th>
            <th className="text-left p-2 font-semibold text-slate-700">Tópico</th>
            <th className="text-left p-2 font-semibold text-slate-700">Tipo</th>
            <th className="text-center p-2 font-semibold text-slate-700">Renames</th>
            <th className="text-center p-2 font-semibold text-slate-700">Extras</th>
            <th className="text-center p-2 font-semibold text-slate-700">Missing</th>
            <th className="text-center p-2 font-semibold text-slate-700">Severidad</th>
            <th className="text-left p-2 font-semibold text-slate-700">Acción</th>
          </tr>
        </thead>
        <tbody>
          {anomalias.map((a) => (
            <AnomaliaRowComponent key={a.id} anomalia={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnomaliaRowComponent({ anomalia }: { anomalia: AnomaliaRow }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReview(action: string) {
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/pipeline/anomalias/${anomalia.id}/review`, {
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
          ✓ Marcada como revisada
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-b hover:bg-slate-50">
        <td className="p-2 font-mono">{anomalia.periodo}</td>
        <td className="p-2">{anomalia.grupo}</td>
        <td className="p-2">{anomalia.topico}</td>
        <td className="p-2 text-slate-500">{anomalia.tipoEstado ?? "—"}</td>
        <td className="p-2 text-center">{anomalia.nRenames}</td>
        <td className="p-2 text-center">{anomalia.nExtras}</td>
        <td className="p-2 text-center">{anomalia.nMissing}</td>
        <td className="p-2 text-center">
          <span
            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${SEVERITY_BG[anomalia.severity]}`}
          >
            {SEVERITY_ICON[anomalia.severity]} {anomalia.severity}
          </span>
        </td>
        <td className="p-2">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-sky-700 hover:underline"
              type="button"
            >
              {expanded ? "Ocultar" : "Ver detalle"}
            </button>
            {REVIEW_ACTIONS.map((act) => (
              <button
                key={act.value}
                onClick={() => handleReview(act.value)}
                disabled={reviewing}
                className="text-[11px] px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
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
              {JSON.stringify(anomalia.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
