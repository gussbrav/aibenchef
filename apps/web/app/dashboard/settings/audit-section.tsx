"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Code,
  KeyRound,
  Loader2,
  Sparkles,
  Users as UsersIcon,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type AuditCategoria = "users" | "ai_providers" | "sql" | "genie";

type AuditEvent = {
  id: string;
  categoria: AuditCategoria;
  accion: string;
  detalle: string | null;
  actorEmail: string | null;
  actorName: string | null;
  targetEmail: string | null;
  createdAt: string;
};

const CAT_META: Record<
  AuditCategoria,
  { label: string; icon: typeof UsersIcon; color: string }
> = {
  users: { label: "Usuarios", icon: UsersIcon, color: "violet" },
  ai_providers: { label: "API keys", icon: KeyRound, color: "amber" },
  sql: { label: "SQL", icon: Code, color: "sky" },
  genie: { label: "Genie", icon: Sparkles, color: "fuchsia" },
};

export function AuditSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cats, setCats] = useState<Record<AuditCategoria, boolean>>({
    users: true,
    ai_providers: true,
    sql: true,
    genie: true,
  });
  const [busqueda, setBusqueda] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activos = (Object.keys(cats) as AuditCategoria[]).filter((k) => cats[k]);
      const url = activos.length > 0
        ? `/api/v1/admin/audit?categorias=${activos.join(",")}&limit=300`
        : `/api/v1/admin/audit?limit=300`;
      const r = await fetch(url);
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else setEvents(json.data.rows as AuditEvent[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cats]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtered = useMemo(() => {
    if (!busqueda.trim()) return events;
    const q = busqueda.toLowerCase();
    return events.filter(
      (e) =>
        e.accion.toLowerCase().includes(q) ||
        (e.detalle ?? "").toLowerCase().includes(q) ||
        (e.actorEmail ?? "").toLowerCase().includes(q) ||
        (e.targetEmail ?? "").toLowerCase().includes(q),
    );
  }, [events, busqueda]);

  const toggleCat = (c: AuditCategoria) => {
    setCats((prev) => ({ ...prev, [c]: !prev[c] }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Auditoria</h2>
        <p className="text-sm text-slate-600 mt-1">
          Registro inmutable de cambios sensibles: roles, API keys, SQL ejecutado y prompts a Genie.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(CAT_META) as AuditCategoria[]).map((c) => {
          const meta = CAT_META[c];
          const Icon = meta.icon;
          const active = cats[c];
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleCat(c)}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 h-8 text-xs rounded border transition-colors",
                active
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white text-slate-600 border-slate-300 hover:border-slate-400",
              )}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </button>
          );
        })}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por accion, email, detalle..."
          className="flex-1 h-8 px-3 text-xs rounded border border-slate-300 focus:border-brand-500 outline-none min-w-0"
        />
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando eventos...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-slate-500 py-8 text-center bg-slate-50 border border-slate-200 rounded">
          Sin eventos para los filtros seleccionados.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold w-28">Categoria</th>
                <th className="text-left px-3 py-2 font-semibold w-40">Accion</th>
                <th className="text-left px-3 py-2 font-semibold">Actor</th>
                <th className="text-left px-3 py-2 font-semibold">Detalle</th>
                <th className="text-left px-3 py-2 font-semibold w-32">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((e) => {
                const meta = CAT_META[e.categoria];
                const Icon = meta.icon;
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider",
                          meta.color === "violet" && "bg-violet-100 text-violet-700",
                          meta.color === "amber" && "bg-amber-100 text-amber-700",
                          meta.color === "sky" && "bg-sky-100 text-sky-700",
                          meta.color === "fuchsia" && "bg-fuchsia-100 text-fuchsia-700",
                        )}
                      >
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{e.accion}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-slate-900 truncate max-w-[160px]" title={e.actorEmail ?? ""}>
                        {e.actorName || "(sistema)"}
                      </div>
                      {e.actorEmail && (
                        <div className="text-slate-500 text-[10px] truncate max-w-[160px]">
                          {e.actorEmail}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700 max-w-md">
                      <span className="line-clamp-2">{e.detalle ?? "—"}</span>
                      {e.targetEmail && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          target: {e.targetEmail}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString("es-PE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
