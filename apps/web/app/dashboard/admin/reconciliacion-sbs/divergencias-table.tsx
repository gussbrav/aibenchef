"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui";
import {
  INDICADOR_LABELS,
  type DivergenceRow,
  type Severidad,
} from "@/lib/domains/ratio-reconciliation";

const MOTIVOS = [
  { value: "liquidacion",           label: "En liquidación" },
  { value: "intervencion_sbs",      label: "Intervención SBS" },
  { value: "fusion_absorcion",      label: "Fusión / Absorción" },
  { value: "metodologia_diferente", label: "Metodología diferente" },
  { value: "otro",                  label: "Otro" },
] as const;

const MOTIVO_LABEL: Record<string, string> = Object.fromEntries(
  MOTIVOS.map((m) => [m.value, m.label]),
);

function SeverityPill({ severidad }: { severidad: Severidad }) {
  const map: Record<Severidad, { label: string; cls: string }> = {
    ok:       { label: "ok",       cls: "bg-emerald-100 text-emerald-800" },
    leve:     { label: "leve",     cls: "bg-amber-100 text-amber-800" },
    alto:     { label: "alto",     cls: "bg-orange-100 text-orange-800" },
    critico:  { label: "crítico",  cls: "bg-rose-100 text-rose-800" },
    excluida: { label: "excluida", cls: "bg-slate-100 text-slate-500" },
  };
  const s = map[severidad] ?? map.ok;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export function DivergenciasTable({
  divergencias,
}: {
  divergencias: DivergenceRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string>("liquidacion");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExcluir(nombCorreg: string) {
    setSaving(nombCorreg);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/reconciliacion/excluir", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombCorreg, excluida: true, motivoExclusion: motivo }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError((j as { error?: string } | null)?.error ?? "Error al excluir la entidad");
        return;
      }
      setExpandedEntity(null);
      startTransition(() => router.refresh());
    } finally {
      setSaving(null);
    }
  }

  async function handleRestaurar(nombCorreg: string) {
    setSaving(nombCorreg);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/reconciliacion/excluir", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombCorreg, excluida: false, motivoExclusion: null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError((j as { error?: string } | null)?.error ?? "Error al restaurar la entidad");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setSaving(null);
    }
  }

  if (divergencias.length === 0) {
    return (
      <Card variant="elevated" className="p-6 flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        <p className="text-sm text-slate-600">
          Sin divergencias. Todos los ratios calculados están dentro de ±5 bps del valor oficial SBS.
        </p>
      </Card>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-2 px-3 py-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {error}
        </div>
      )}
      <Card variant="elevated" className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Severidad</th>
              <th className="text-left px-4 py-2 font-semibold">Entidad</th>
              <th className="text-left px-4 py-2 font-semibold">Indicador</th>
              <th className="text-right px-4 py-2 font-semibold">Nuestro</th>
              <th className="text-right px-4 py-2 font-semibold">SBS</th>
              <th className="text-right px-4 py-2 font-semibold">Δ (bps)</th>
              <th className="text-left px-4 py-2 font-semibold">Notas</th>
              <th className="text-left px-4 py-2 font-semibold w-40">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {divergencias.map((d) => {
              const isMuted = d.excluida;
              const isExpanded = expandedEntity === d.nombCorreg && !d.excluida;
              const isSaving = saving === d.nombCorreg;
              return (
                <tr
                  key={`${d.periodo}:${d.nombCorreg}:${d.indicador}`}
                  className={`border-t border-slate-100 transition-opacity ${
                    isMuted ? "opacity-50" : "hover:bg-slate-50/60"
                  }`}
                >
                  <td className="px-4 py-2">
                    <SeverityPill severidad={d.severidad} />
                  </td>
                  <td className="px-4 py-2 text-slate-800">
                    {d.nombCorreg}
                    {d.excluida && d.motivoExclusion && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold bg-slate-100 text-slate-500">
                        {MOTIVO_LABEL[d.motivoExclusion] ?? d.motivoExclusion}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-700">
                    {INDICADOR_LABELS[d.indicador]}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-800">
                    {d.derivedValue.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-800">
                    {d.sbsValue.toFixed(2)}%
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono font-semibold ${
                      d.deltaBps > 0 ? "text-rose-700" : "text-sky-700"
                    }`}
                  >
                    {d.deltaBps > 0 ? "+" : ""}
                    {d.deltaBps}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 max-w-xs truncate">
                    {d.notas ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {d.excluida ? (
                      <button
                        onClick={() => handleRestaurar(d.nombCorreg)}
                        disabled={isSaving}
                        className="text-[11px] text-brand-600 hover:underline disabled:opacity-50"
                      >
                        {isSaving ? "Restaurando…" : "Restaurar"}
                      </button>
                    ) : isExpanded ? (
                      <div className="flex flex-col gap-1.5 min-w-[156px]">
                        <select
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          className="text-[11px] border border-slate-300 rounded px-1.5 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-400"
                        >
                          {MOTIVOS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleExcluir(d.nombCorreg)}
                            disabled={isSaving}
                            className="text-[11px] px-2.5 py-0.5 rounded bg-slate-700 text-white hover:bg-slate-900 disabled:opacity-50"
                          >
                            {isSaving ? "Guardando…" : "Confirmar"}
                          </button>
                          <button
                            onClick={() => setExpandedEntity(null)}
                            className="text-[11px] px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setExpandedEntity(d.nombCorreg);
                          setMotivo("liquidacion");
                        }}
                        className="text-[11px] text-slate-400 hover:text-slate-700"
                        title="Excluir esta entidad del semáforo de accuracy (todos los períodos)"
                      >
                        Excluir entidad
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
