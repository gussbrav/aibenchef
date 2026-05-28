"use client";

/**
 * Client component del Cabecera Aligner — selectores + tabla missing + audit log.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle, Loader2 } from "lucide-react";

import type { CabeceraDiffRow, TipoEstado } from "@/lib/domains/pipeline";

export function CabeceraAlignerClient({
  tiposEstado,
  tiposEntidad,
  periodos,
  currentTipoEstado,
  currentTipoEntidad,
  currentPeriodo,
  diff,
  auditLog,
}: {
  tiposEstado: TipoEstado[];
  tiposEntidad: string[];
  periodos: number[];
  currentTipoEstado: TipoEstado;
  currentTipoEntidad: string;
  currentPeriodo: number;
  diff: CabeceraDiffRow[];
  auditLog: {
    id: number;
    codigo: string | null;
    nombre: string;
    orden: number;
    accion: string;
    performedBy: string;
    performedAt: string;
    motivo: string | null;
  }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const navigate = (newParams: Partial<{ tipoEstado: TipoEstado; tipoEntidad: string; periodo: number }>) => {
    const params = new URLSearchParams();
    params.set("tipoEstado", newParams.tipoEstado ?? currentTipoEstado);
    params.set("tipoEntidad", newParams.tipoEntidad ?? currentTipoEntidad);
    params.set("periodo", String(newParams.periodo ?? currentPeriodo));
    setSelected(new Set());
    setSuccess(null);
    setError(null);
    startTransition(() => {
      router.push(`/dashboard/admin/cabecera-aligner?${params}` as never);
    });
  };

  const toggleAll = () => {
    if (selected.size === diff.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(diff.map((r) => r.cuentaCodigo)));
    }
  };

  const toggleCodigo = (codigo: string) => {
    const next = new Set(selected);
    if (next.has(codigo)) next.delete(codigo);
    else next.add(codigo);
    setSelected(next);
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/v1/admin/pipeline/cabecera/align", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoEstado: currentTipoEstado,
          tipoEntidad: currentTipoEntidad,
          codigos: Array.from(selected),
          periodoSrc: currentPeriodo,
          motivo: motivo || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const { changes } = (await res.json()) as { changes: number };
      setSuccess(`✓ ${changes} codigos alineados correctamente. Refrescando…`);
      setMotivo("");
      setTimeout(() => {
        router.refresh();
        setSelected(new Set());
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`space-y-6 ${isPending ? "opacity-60" : ""}`}>
      {/* Selectores */}
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
        <SelectField
          label="Tipo estado"
          value={currentTipoEstado}
          onChange={(v) => navigate({ tipoEstado: v as TipoEstado })}
          options={tiposEstado.map((t) => ({
            value: t,
            label: t === "balance" ? "Balance General" : "Estado de Resultados",
          }))}
        />
        <SelectField
          label="Tipo entidad"
          value={currentTipoEntidad}
          onChange={(v) => navigate({ tipoEntidad: v })}
          options={tiposEntidad.map((t) => ({ value: t, label: t }))}
        />
        <SelectField
          label="Periodo (fuente de nombres)"
          value={String(currentPeriodo)}
          onChange={(v) => navigate({ periodo: Number(v) })}
          options={periodos.map((p) => ({ value: String(p), label: formatPeriodo(p) }))}
        />
        <div className="ml-auto text-[11px] text-slate-500">
          {diff.length} codigos missing
        </div>
      </div>

      {/* Tabla missing */}
      {diff.length === 0 ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-emerald-700" />
          <p className="text-sm text-emerald-900">
            ✅ Cabecera alineada — no hay cuentas en raw que falten en la cabecera-base
            para <code className="font-mono">{currentTipoEstado}</code> / <code className="font-mono">{currentTipoEntidad}</code> /{" "}
            <code className="font-mono">{currentPeriodo}</code>.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={toggleAll}
              className="px-3 py-1 rounded border border-slate-300 hover:bg-slate-100 text-xs"
              type="button"
            >
              {selected.size === diff.length ? "Deseleccionar todos" : "Seleccionar todos"}
            </button>
            <span className="text-slate-500 text-xs">
              {selected.size} de {diff.length} seleccionados
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="text-center p-2 w-8">✓</th>
                  <th className="text-left p-2 font-semibold text-slate-700">Código</th>
                  <th className="text-left p-2 font-semibold text-slate-700">
                    Nombre en raw
                  </th>
                  <th className="text-right p-2 font-semibold text-slate-700">
                    Entidades
                  </th>
                </tr>
              </thead>
              <tbody>
                {diff.map((row) => (
                  <tr
                    key={row.cuentaCodigo}
                    className={`border-b cursor-pointer hover:bg-amber-50 ${
                      selected.has(row.cuentaCodigo) ? "bg-amber-50" : ""
                    }`}
                    onClick={() => toggleCodigo(row.cuentaCodigo)}
                  >
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(row.cuentaCodigo)}
                        onChange={() => toggleCodigo(row.cuentaCodigo)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-2 font-mono">{row.cuentaCodigo}</td>
                    <td className="p-2">{row.cuentaNombreRaw}</td>
                    <td className="p-2 text-right font-mono text-slate-600">
                      {row.nEntidades}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Acción */}
          <div className="border-t border-slate-200 pt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 flex-1 min-w-[300px]">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600">
                Motivo (opcional)
              </span>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: Alineacion drift SBS detectado en Banco Alfin"
                className="border border-slate-300 rounded px-2 py-1 text-xs"
              />
            </label>
            <button
              onClick={submit}
              disabled={selected.size === 0 || submitting}
              className="px-4 py-1.5 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
              type="button"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Aplicar align ({selected.size})
            </button>
          </div>

          {success && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 text-sm">
              {success}
            </div>
          )}
          {error && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-red-900 text-sm">
              ✗ Error: {error}
            </div>
          )}
        </section>
      )}

      {/* Audit log */}
      {auditLog.length > 0 && (
        <section className="space-y-2 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Audit log — últimos {auditLog.length} cambios en cabecera{" "}
            <code className="font-mono text-xs">
              {currentTipoEstado}/{currentTipoEntidad}
            </code>
          </h3>
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="bg-slate-50 border-b text-slate-700">
                <th className="text-left p-1">Fecha</th>
                <th className="text-left p-1">Acción</th>
                <th className="text-left p-1">Código</th>
                <th className="text-left p-1">Nombre</th>
                <th className="text-right p-1">Orden</th>
                <th className="text-left p-1">Por</th>
                <th className="text-left p-1">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="p-1 text-slate-500 font-mono text-[10px]">
                    {formatDateTime(a.performedAt)}
                  </td>
                  <td className="p-1">{a.accion}</td>
                  <td className="p-1 font-mono">{a.codigo ?? "—"}</td>
                  <td className="p-1">{a.nombre.slice(0, 50)}</td>
                  <td className="p-1 text-right font-mono">{a.orden}</td>
                  <td className="p-1 text-[10px] text-slate-500">{a.performedBy}</td>
                  <td className="p-1 text-[10px] text-slate-500">{a.motivo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[180px]">
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

function formatPeriodo(p: number): string {
  return `${Math.floor(p / 100)}-${String(p % 100).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
