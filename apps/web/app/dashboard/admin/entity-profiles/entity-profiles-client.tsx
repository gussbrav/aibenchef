"use client";

import { useEffect, useState, useCallback } from "react";
import { Check, RefreshCw, Pencil, X, ExternalLink } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-modal";

type Profile = {
  nombCorreg: string;
  tipoEntidad: string | null;
  ubicacion: string | null;
  inicioOperaciones: string | null;
  rucSunat: string | null;
  publicoObjetivo: string | null;
  modeloNegocio: "cerrada" | "abierta" | "mixta" | "desconocido" | null;
  segmentoCarteraHipotesis: string | null;
  productosPrincipales: string | null;
  notas: string | null;
  fuentes: string[];
  researchAt: string | null;
  researchModel: string | null;
  researchCostUsd: number;
  researchCount: number;
  verifiedByHuman: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  useCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
};

type ListResult = { rows: Profile[]; total: number };

export function EntityProfilesClient() {
  const confirm = useConfirm();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "verified" | "pending">("all");
  const [editing, setEditing] = useState<Profile | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/entity-profiles?filter=${filter}&limit=100`);
      const d = (await r.json().catch(() => ({}))) as ListResult & {
        error?: string;
        hint?: string;
      };
      if (!r.ok) {
        const parts = [d.error ?? `HTTP ${r.status}`];
        if (d.hint) parts.push(d.hint);
        throw new Error(parts.join(" — "));
      }
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerify = async (nombCorreg: string) => {
    setActioning(nombCorreg);
    try {
      const r = await fetch(
        `/api/v1/admin/entity-profiles/${encodeURIComponent(nombCorreg)}/verify`,
        { method: "POST" },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast("ok", `${nombCorreg} marcado como validado`);
      await load();
    } catch (err) {
      showToast("err", `Error validando: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActioning(null);
    }
  };

  const handleResearch = async (nombCorreg: string, tipoEntidad: string | null) => {
    const ok = await confirm({
      title: `Reinvestigar ${nombCorreg}`,
      message: "Esto consume ~$0.10 de la API de Claude y sobrescribe el perfil actual con el resultado nuevo. Los campos editados manualmente que ya tengas se preservan solo si el research devuelve null para ellos.",
      confirmLabel: "Reinvestigar",
      cancelLabel: "Cancelar",
    });
    if (!ok) return;
    setActioning(nombCorreg);
    try {
      const r = await fetch(
        `/api/v1/admin/entity-profiles/${encodeURIComponent(nombCorreg)}/research`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tipoEntidad }),
        },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      showToast("ok", `${nombCorreg} reinvestigado (costo $${(body.cost ?? 0).toFixed(4)})`);
      await load();
    } catch (err) {
      showToast("err", `Error en research: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActioning(null);
    }
  };

  const verified = data?.rows.filter((p) => p.verifiedByHuman).length ?? 0;
  const pending = data?.rows.filter((p) => !p.verifiedByHuman).length ?? 0;
  const totalCost = (data?.rows ?? []).reduce((s, p) => s + p.researchCostUsd, 0);

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total perfiles" value={data?.total.toString() ?? "—"} />
        <StatCard label="Validados" value={verified.toString()} tone="emerald" />
        <StatCard label="Preliminares" value={pending.toString()} tone="amber" />
        <StatCard
          label="Costo acumulado"
          value={`$${totalCost.toFixed(4)}`}
          tone="slate"
        />
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2">
        {(["all", "verified", "pending"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded border ${
              filter === f
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
            }`}
          >
            {f === "all" ? "Todos" : f === "verified" ? "Validados" : "Preliminares"}
          </button>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto px-3 py-1.5 text-sm rounded border border-slate-300 hover:border-slate-400 flex items-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Recargar
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-sm">
          Error: {error}
        </div>
      )}

      {/* Tabla — layout compacto, sin scroll horizontal. Acciones siempre visibles. */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
            <col className="w-[110px]" />
          </colgroup>
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Entidad</th>
              <th className="text-left px-3 py-2 font-semibold">Ubicación</th>
              <th className="text-left px-3 py-2 font-semibold">Público objetivo</th>
              <th className="text-left px-3 py-2 font-semibold">Modelo</th>
              <th className="text-right px-3 py-2 font-semibold">Usos · Costo</th>
              <th className="text-right px-3 py-2 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && (data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  No hay perfiles para este filtro.
                </td>
              </tr>
            )}
            {data?.rows.map((p) => (
              <tr key={p.nombCorreg} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-3 py-2.5 align-top">
                  <div className="font-medium text-slate-900 truncate" title={p.nombCorreg}>
                    {p.nombCorreg}
                  </div>
                  <div className="mt-0.5">
                    {p.verifiedByHuman ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                        Validado
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                        Preliminar
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 align-top text-slate-700 truncate" title={p.ubicacion ?? ""}>
                  {p.ubicacion ?? "—"}
                </td>
                <td className="px-3 py-2.5 align-top text-slate-700 truncate" title={p.publicoObjetivo ?? ""}>
                  {p.publicoObjetivo ?? <span className="text-slate-400">— sin research</span>}
                </td>
                <td className="px-3 py-2.5 align-top">
                  {p.modeloNegocio ? (
                    <span className="text-xs text-slate-700 capitalize">{p.modeloNegocio}</span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top text-right">
                  <div className="text-slate-700 tabular-nums">{p.useCount} usos</div>
                  <div className="text-[11px] text-slate-500 tabular-nums">${p.researchCostUsd.toFixed(4)}</div>
                </td>
                <td className="px-3 py-2.5 align-top text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      onClick={() => setEditing(p)}
                      className="p-1.5 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {!p.verifiedByHuman && (
                      <button
                        onClick={() => void handleVerify(p.nombCorreg)}
                        disabled={actioning === p.nombCorreg}
                        className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700 disabled:opacity-40 transition-colors"
                        title="Marcar como validado"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => void handleResearch(p.nombCorreg, p.tipoEntidad)}
                      disabled={actioning === p.nombCorreg}
                      className="p-1.5 rounded hover:bg-blue-100 text-blue-700 disabled:opacity-40 transition-colors"
                      title="Reinvestigar (~$0.10)"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${actioning === p.nombCorreg ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditModal
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            showToast("ok", `${editing.nombCorreg} guardado y validado`);
            void load();
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[90] px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm ${
            toast.kind === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "amber";
}) {
  const colors: Record<string, string> = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}

function EditModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    ubicacion: profile.ubicacion ?? "",
    inicioOperaciones: profile.inicioOperaciones ?? "",
    rucSunat: profile.rucSunat ?? "",
    publicoObjetivo: profile.publicoObjetivo ?? "",
    modeloNegocio: profile.modeloNegocio ?? "",
    segmentoCarteraHipotesis: profile.segmentoCarteraHipotesis ?? "",
    productosPrincipales: profile.productosPrincipales ?? "",
    notas: profile.notas ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(form)) {
        payload[key] = value === "" ? null : value;
      }
      const r = await fetch(
        `/api/v1/admin/entity-profiles/${encodeURIComponent(profile.nombCorreg)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">
            {profile.nombCorreg}
            {profile.tipoEntidad && (
              <span className="ml-2 text-xs text-slate-500">({profile.tipoEntidad})</span>
            )}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-slate-500">
            Al guardar, el perfil se marca automáticamente como <strong>validado</strong>.
            {profile.fuentes.length > 0 && (
              <span>
                {" "}Fuentes del research original:{" "}
                {profile.fuentes.slice(0, 3).map((u, i) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-blue-700 hover:underline ml-1"
                  >
                    [{i + 1}] <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </span>
            )}
          </p>
          <Field label="Ubicación" value={form.ubicacion} onChange={(v) => setForm({ ...form, ubicacion: v })} />
          <Field label="Inicio operaciones" value={form.inicioOperaciones} onChange={(v) => setForm({ ...form, inicioOperaciones: v })} />
          <Field label="RUC SUNAT" value={form.rucSunat} onChange={(v) => setForm({ ...form, rucSunat: v })} />
          <TextArea label="Público objetivo" value={form.publicoObjetivo} onChange={(v) => setForm({ ...form, publicoObjetivo: v })} />
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Modelo de negocio</label>
            <select
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              value={form.modeloNegocio}
              onChange={(e) => setForm({ ...form, modeloNegocio: e.target.value })}
            >
              <option value="">— sin determinar —</option>
              <option value="cerrada">Cerrada (vínculo laboral / gremial)</option>
              <option value="abierta">Abierta al público</option>
              <option value="mixta">Mixta</option>
              <option value="desconocido">Desconocido</option>
            </select>
          </div>
          <TextArea label="Segmento de cartera (hipótesis)" value={form.segmentoCarteraHipotesis} onChange={(v) => setForm({ ...form, segmentoCarteraHipotesis: v })} />
          <TextArea label="Productos principales" value={form.productosPrincipales} onChange={(v) => setForm({ ...form, productosPrincipales: v })} />
          <TextArea label="Notas" value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} rows={3} />
          {err && <div className="text-sm text-red-700">Error: {err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-white">
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar y validar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700 mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
      />
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700 mb-1 block">{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm resize-y"
      />
    </div>
  );
}
