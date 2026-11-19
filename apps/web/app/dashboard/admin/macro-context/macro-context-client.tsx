"use client";

import { useEffect, useState, useCallback } from "react";
import { Check, RefreshCw, Pencil, Trash2, X, ExternalLink } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-modal";

type MacroItem = {
  id: string;
  snapshotAt: string;
  categoria: "climatico" | "macro" | "politico" | "regulatorio" | "sectorial";
  titulo: string;
  resumen: string;
  impacto: string | null;
  severidad: "alta" | "media" | "baja" | "informativo";
  vigenteHasta: string | null;
  fuentes: string[];
  researchModel: string | null;
  researchCostUsd: number;
  verifiedByHuman: boolean;
  verifiedBy: string | null;
  updatedAt: string;
};

type ListResult = {
  rows: MacroItem[];
  total: number;
  lastRefresh: {
    startedAt: string;
    finishedAt: string | null;
    status: string;
    itemsCreated: number;
    itemsUpdated: number;
    costUsd: number;
    triggeredBy: string | null;
  } | null;
};

export function MacroContextClient() {
  const confirm = useConfirm();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "vigentes" | "expirados" | "pending">("vigentes");
  const [editing, setEditing] = useState<MacroItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/macro-context?filter=${filter}&limit=100`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as ListResult;
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

  const handleRefresh = async () => {
    const ok = await confirm({
      title: "Refrescar contexto macro",
      message:
        "Esto llama a Claude con web_search para traer el estado actual (Niño, tasas BCR, circulares SBS, etc.). Costo ~$0.10-0.30, tarda 20-40 segundos. Los items vigentes se preservan; se insertan los nuevos resultados.",
      confirmLabel: "Refrescar ahora",
      cancelLabel: "Cancelar",
    });
    if (!ok) return;
    setRefreshing(true);
    try {
      const r = await fetch(`/api/v1/admin/macro-context/refresh`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) {
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      showToast(
        "ok",
        `Refresh completado: ${body.itemsCreated} nuevos, ${body.itemsExpired} expirados, $${(body.costUsd ?? 0).toFixed(4)}`,
      );
      await load();
    } catch (err) {
      showToast("err", `Error en refresh: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleVerify = async (id: string) => {
    setActioning(id);
    try {
      const r = await fetch(`/api/v1/admin/macro-context/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verify: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast("ok", "Ítem validado");
      await load();
    } catch (err) {
      showToast("err", `Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActioning(null);
    }
  };

  const handleDelete = async (item: MacroItem) => {
    const ok = await confirm({
      title: `Eliminar "${item.titulo}"`,
      message: "Esta acción borra el ítem del contexto macro definitivamente. No se puede deshacer.",
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    setActioning(item.id);
    try {
      const r = await fetch(`/api/v1/admin/macro-context/${item.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast("ok", "Ítem eliminado");
      await load();
    } catch (err) {
      showToast("err", `Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActioning(null);
    }
  };

  const verifiedCount = data?.rows.filter((i) => i.verifiedByHuman).length ?? 0;
  const pendingCount = data?.rows.filter((i) => !i.verifiedByHuman).length ?? 0;
  const totalCost = (data?.rows ?? []).reduce((s, i) => s + i.researchCostUsd, 0);

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Ítems totales" value={data?.total.toString() ?? "—"} />
        <StatCard label="Validados" value={verifiedCount.toString()} tone="emerald" />
        <StatCard label="Preliminares" value={pendingCount.toString()} tone="amber" />
        <StatCard label="Costo acumulado" value={`$${totalCost.toFixed(4)}`} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {(["vigentes", "all", "expirados", "pending"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded border ${
              filter === f
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
            }`}
          >
            {f === "all"
              ? "Todos"
              : f === "vigentes"
                ? "Vigentes"
                : f === "expirados"
                  ? "Expirados"
                  : "Preliminares"}
          </button>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto px-3 py-1.5 text-sm rounded border border-slate-300 hover:border-slate-400 flex items-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Recargar
        </button>
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="px-3 py-1.5 text-sm rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refrescando…" : "Refrescar contexto"}
        </button>
      </div>

      {/* Last refresh info */}
      {data?.lastRefresh && (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          Último refresh:{" "}
          <strong>{new Date(data.lastRefresh.startedAt).toLocaleString()}</strong> ·{" "}
          {data.lastRefresh.status === "ok" ? "✓" : "✗"} {data.lastRefresh.status} ·{" "}
          {data.lastRefresh.itemsCreated} ítems creados · costo $
          {data.lastRefresh.costUsd.toFixed(4)} · disparado por{" "}
          {data.lastRefresh.triggeredBy ?? "—"}
        </div>
      )}

      {error && (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-sm">
          Error: {error}
        </div>
      )}

      {/* Lista en cards */}
      {loading ? (
        <div className="text-center text-slate-500 py-8">Cargando…</div>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <div className="text-center text-slate-500 py-8 bg-white border border-slate-200 rounded-lg">
          No hay ítems para este filtro.
          {filter === "vigentes" && (
            <div className="text-xs mt-2">
              Dispará un refresh para traer el contexto macro actual.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data?.rows.map((item) => (
            <div
              key={item.id}
              className={`bg-white border rounded-lg p-4 ${
                item.vigenteHasta &&
                new Date(item.vigenteHasta) < new Date()
                  ? "border-slate-200 opacity-70"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <SevBadge sev={item.severidad} />
                    <CatBadge cat={item.categoria} />
                    {item.verifiedByHuman ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        Validado
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        Preliminar
                      </span>
                    )}
                    {item.vigenteHasta && (
                      <span className="text-xs text-slate-500">
                        Vigente hasta {item.vigenteHasta}
                      </span>
                    )}
                  </div>
                  <h4 className="font-semibold text-slate-900">{item.titulo}</h4>
                  <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                    {item.resumen}
                  </p>
                  {item.impacto && (
                    <p className="text-xs text-slate-600 mt-2 italic">
                      Impacto: {item.impacto}
                    </p>
                  )}
                  {item.fuentes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs text-slate-400">Fuentes:</span>
                      {item.fuentes.slice(0, 5).map((u, i) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs text-blue-700 hover:underline"
                        >
                          [{i + 1}] <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditing(item)}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {!item.verifiedByHuman && (
                    <button
                      onClick={() => void handleVerify(item.id)}
                      disabled={actioning === item.id}
                      className="p-1.5 rounded hover:bg-emerald-50 text-emerald-700 disabled:opacity-40"
                      title="Marcar como validado"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => void handleDelete(item)}
                    disabled={actioning === item.id}
                    className="p-1.5 rounded hover:bg-rose-50 text-rose-700 disabled:opacity-40"
                    title="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            const titulo = editing.titulo;
            setEditing(null);
            showToast("ok", `"${titulo}" guardado`);
            void load();
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[90] px-4 py-3 rounded-lg shadow-lg text-sm max-w-md ${
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
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

function SevBadge({ sev }: { sev: MacroItem["severidad"] }) {
  const map: Record<MacroItem["severidad"], string> = {
    alta: "bg-rose-100 text-rose-700",
    media: "bg-amber-100 text-amber-700",
    baja: "bg-sky-100 text-sky-700",
    informativo: "bg-slate-100 text-slate-700",
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[sev]}`}>{sev}</span>;
}

function CatBadge({ cat }: { cat: MacroItem["categoria"] }) {
  const map: Record<MacroItem["categoria"], string> = {
    climatico: "bg-sky-100 text-sky-700",
    macro: "bg-indigo-100 text-indigo-700",
    politico: "bg-purple-100 text-purple-700",
    regulatorio: "bg-amber-100 text-amber-700",
    sectorial: "bg-teal-100 text-teal-700",
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${map[cat]}`}>{cat}</span>;
}

function EditModal({
  item,
  onClose,
  onSaved,
}: {
  item: MacroItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    titulo: item.titulo,
    resumen: item.resumen,
    impacto: item.impacto ?? "",
    severidad: item.severidad,
    vigenteHasta: item.vigenteHasta ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/v1/admin/macro-context/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titulo: form.titulo,
          resumen: form.resumen,
          impacto: form.impacto === "" ? null : form.impacto,
          severidad: form.severidad,
          vigenteHasta: form.vigenteHasta === "" ? null : form.vigenteHasta,
          verify: true,
        }),
      });
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
          <h3 className="font-semibold text-slate-900">Editar ítem macro</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-slate-500">
            Al guardar, el ítem se marca como <strong>validado</strong>.
          </p>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Título</label>
            <input
              type="text"
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Resumen</label>
            <textarea
              rows={4}
              value={form.resumen}
              onChange={(e) => setForm({ ...form, resumen: e.target.value })}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Impacto</label>
            <textarea
              rows={2}
              value={form.impacto}
              onChange={(e) => setForm({ ...form, impacto: e.target.value })}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm resize-y"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Severidad</label>
              <select
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                value={form.severidad}
                onChange={(e) =>
                  setForm({ ...form, severidad: e.target.value as MacroItem["severidad"] })
                }
              >
                <option value="alta">alta</option>
                <option value="media">media</option>
                <option value="baja">baja</option>
                <option value="informativo">informativo</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">
                Vigente hasta
              </label>
              <input
                type="date"
                value={form.vigenteHasta}
                onChange={(e) => setForm({ ...form, vigenteHasta: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
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
