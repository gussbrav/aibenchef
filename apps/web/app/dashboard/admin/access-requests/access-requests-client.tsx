"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveX,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Mail,
  Mailbox,
  MailQuestion,
  PauseCircle,
  Search,
  Send,
  User as UserIcon,
  Users,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useConfirm } from "@/components/ui";

type Status = "pending" | "approved" | "rejected" | "spam";

type Req = {
  id: string;
  email: string;
  nombre: string;
  empresa: string;
  rol: string | null;
  tamanoEquipo: string | null;
  casoUso: string | null;
  source: string;
  status: Status;
  notasAdmin: string | null;
  rejectionReason: string | null;
  invitationId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const TABS: Array<{ value: Status | "all"; label: string; icon: typeof Mail }> = [
  { value: "pending", label: "Pendientes", icon: MailQuestion },
  { value: "approved", label: "Aprobadas", icon: CheckCircle2 },
  { value: "rejected", label: "Rechazadas", icon: XCircle },
  { value: "spam", label: "Spam", icon: ArchiveX },
  { value: "all", label: "Todas", icon: Mail },
];

export function AccessRequestsClient() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | "all">("pending");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [rows, setRows] = useState<Req[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Req | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "err"; mensaje: string } | null>(
    null,
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (search.trim()) params.set("search", search.trim());
      const r = await fetch(`/api/v1/admin/access-requests?${params}`);
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else {
        setRows(json.data.rows as Req[]);
        setTotal(json.data.total as number);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Debounce de search input
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const aprobar = async (req: Req, role: "admin" | "usuario") => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await fetch(`/api/v1/admin/access-requests/${req.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const json = await r.json();
      if (json.error) {
        setFeedback({ tipo: "err", mensaje: json.error.message ?? "Error" });
        return;
      }
      setFeedback({
        tipo: "ok",
        mensaje: json.data.emailSent
          ? `Aprobado y email de invitacion enviado a ${req.email}.`
          : `Aprobado. El email NO se envio (verifica config SMTP en Settings).`,
      });
      setSelected(null);
      cargar();
    } catch (e) {
      setFeedback({ tipo: "err", mensaje: String(e) });
    } finally {
      setBusy(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const rechazar = async (req: Req) => {
    const reason = window.prompt(
      `¿Razon de rechazo para ${req.email}? (opcional, queda en el log)`,
      "",
    );
    if (reason === null) return; // user clicked cancel
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/admin/access-requests/${req.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const json = await r.json();
      if (json.error) {
        setFeedback({ tipo: "err", mensaje: json.error.message ?? "Error" });
        return;
      }
      setFeedback({ tipo: "ok", mensaje: `Rechazado.` });
      setSelected(null);
      cargar();
    } catch (e) {
      setFeedback({ tipo: "err", mensaje: String(e) });
    } finally {
      setBusy(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const marcarSpam = async (req: Req) => {
    const ok = await confirm({
      title: `Marcar como spam`,
      message: `Vas a archivar la solicitud de ${req.email}. No se notifica al solicitante.`,
      confirmLabel: "Marcar spam",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/admin/access-requests/${req.id}`, {
        method: "DELETE",
      });
      const json = await r.json();
      if (json.error) {
        setFeedback({ tipo: "err", mensaje: json.error.message ?? "Error" });
        return;
      }
      setFeedback({ tipo: "ok", mensaje: `Marcado como spam.` });
      setSelected(null);
      cargar();
    } catch (e) {
      setFeedback({ tipo: "err", mensaje: String(e) });
    } finally {
      setBusy(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const conteoPorStatus = useMemo(() => {
    // Conteo aproximado en la vista actual — el total real lo trae cada tab.
    return rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={cn(
            "p-3 rounded-lg border flex items-start justify-between gap-2",
            feedback.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800",
          )}
        >
          <span className="text-sm">{feedback.mensaje}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = status === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setStatus(t.value)}
                className={cn(
                  "px-3 h-8 text-xs font-medium rounded inline-flex items-center gap-1.5 transition",
                  active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {active && total > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded font-mono">
                    {total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar email, empresa, nombre..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-slate-300 focus:border-brand-500 outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Cargando solicitudes...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white border border-slate-200 rounded-lg">
          <Mailbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600">
            {search
              ? `Sin resultados para "${search}".`
              : status === "pending"
                ? "No hay solicitudes pendientes."
                : "Sin solicitudes en esta categoria."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
          {/* Lista */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Solicitante</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Empresa</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={cn(
                      "cursor-pointer hover:bg-slate-50 transition",
                      selected?.id === r.id && "bg-brand-50/40",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 truncate">
                        {r.nombre}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {r.email}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-700 truncate">{r.empresa}</div>
                      {r.rol && (
                        <div className="text-xs text-slate-500 truncate">{r.rol}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[11px] text-slate-500 bg-slate-50 border-t border-slate-100">
              {rows.length} de {total} solicitud{total === 1 ? "" : "es"}
              {Object.keys(conteoPorStatus).length > 1 &&
                ` · ${Object.entries(conteoPorStatus)
                  .map(([s, n]) => `${n} ${s}`)
                  .join(" · ")}`}
            </div>
          </div>

          {/* Detalle */}
          {selected && (
            <DetailPanel
              req={selected}
              busy={busy}
              onClose={() => setSelected(null)}
              onApprove={(role) => aprobar(selected, role)}
              onReject={() => rechazar(selected)}
              onSpam={() => marcarSpam(selected)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const cfg: Record<Status, { bg: string; text: string; label: string; icon: typeof Mail }> = {
    pending: { bg: "bg-amber-100", text: "text-amber-800", label: "Pendiente", icon: PauseCircle },
    approved: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Aprobado", icon: CheckCircle2 },
    rejected: { bg: "bg-rose-100", text: "text-rose-800", label: "Rechazado", icon: XCircle },
    spam: { bg: "bg-slate-200", text: "text-slate-700", label: "Spam", icon: ArchiveX },
  };
  const c = cfg[status];
  const Icon = c.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium uppercase tracking-wider",
        c.bg,
        c.text,
      )}
    >
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}

function DetailPanel({
  req,
  busy,
  onClose,
  onApprove,
  onReject,
  onSpam,
}: {
  req: Req;
  busy: boolean;
  onClose: () => void;
  onApprove: (role: "admin" | "usuario") => void;
  onReject: () => void;
  onSpam: () => void;
}) {
  return (
    <aside className="bg-white border border-slate-200 rounded-lg overflow-hidden h-fit sticky top-4">
      <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 truncate">{req.nombre}</h3>
          <p className="text-xs text-slate-500 truncate flex items-center gap-1">
            <Mail className="w-3 h-3" />
            {req.email}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 flex-shrink-0"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="p-4 space-y-3">
        <StatusBadge status={req.status} />

        <Field icon={Building2} label="Empresa" value={req.empresa} />
        {req.rol && <Field icon={UserIcon} label="Cargo" value={req.rol} />}
        {req.tamanoEquipo && (
          <Field icon={Users} label="Tamaño equipo" value={req.tamanoEquipo} />
        )}
        <Field
          icon={Calendar}
          label="Solicitud"
          value={new Date(req.createdAt).toLocaleString("es-PE", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        />

        {req.casoUso && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Caso de uso
            </p>
            <p className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded p-2 whitespace-pre-wrap leading-relaxed">
              {req.casoUso}
            </p>
          </div>
        )}

        {req.rejectionReason && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-rose-700 font-semibold mb-1">
              Razon de rechazo
            </p>
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded p-2 whitespace-pre-wrap leading-relaxed">
              {req.rejectionReason}
            </p>
          </div>
        )}

        {req.status === "pending" && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Acciones
            </p>
            <button
              type="button"
              onClick={() => onApprove("usuario")}
              disabled={busy}
              className="w-full h-9 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded inline-flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Aprobar como usuario + enviar invitacion
            </button>
            <button
              type="button"
              onClick={() => onApprove("admin")}
              disabled={busy}
              className="w-full h-9 px-3 text-xs font-semibold bg-white border border-violet-300 hover:bg-violet-50 disabled:opacity-50 text-violet-800 rounded inline-flex items-center justify-center gap-2"
            >
              <Check className="w-3.5 h-3.5" />
              Aprobar como ADMIN
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="w-full h-9 px-3 text-xs font-semibold bg-white border border-rose-300 hover:bg-rose-50 disabled:opacity-50 text-rose-700 rounded inline-flex items-center justify-center gap-2"
            >
              <XCircle className="w-3.5 h-3.5" />
              Rechazar
            </button>
            <button
              type="button"
              onClick={onSpam}
              disabled={busy}
              className="w-full h-9 px-3 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-600 rounded inline-flex items-center justify-center gap-2"
            >
              <ArchiveX className="w-3.5 h-3.5" />
              Marcar como spam
            </button>
          </div>
        )}

        {req.status === "approved" && req.invitationId && (
          <div className="pt-3 border-t border-slate-100">
            <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Aprobado
            </p>
            <p className="text-xs text-slate-600">
              Invitacion creada{" "}
              <span className="font-mono text-[10px]">{req.invitationId.slice(0, 8)}...</span>
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              <ChevronRight className="w-3 h-3 inline" />
              Ver detalle en Settings → Invitaciones
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5 inline-flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      <p className="text-xs text-slate-800 break-words">{value}</p>
    </div>
  );
}

