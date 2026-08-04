"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Info,
  Loader2,
  Mail,
  MailX,
  Plus,
  RotateCcw,
  Search,
  Send,
  Shield,
  User as UserIcon,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type Invitation = {
  id: string;
  token: string;
  email: string;
  role: "admin" | "usuario";
  invitedBy: string;
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  archivedAt: string | null;
  notas: string | null;
  defaultClienteSlug: string | null;
  createdAt: string;
  url: string;
};

type ClienteOpcion = { slug: string; nombre: string; nombreCorto: string };

type EstadoHistorial = "aceptada" | "revocada" | "expirada";

function estadoDe(inv: Invitation): EstadoHistorial | "pendiente" {
  if (inv.acceptedAt) return "aceptada";
  if (inv.revokedAt) return "revocada";
  if (new Date(inv.expiresAt) <= new Date()) return "expirada";
  return "pendiente";
}

function tiempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (abs < min) return "hace segundos";
  if (abs < hr) return `hace ${Math.floor(abs / min)} min`;
  if (abs < day) return `hace ${Math.floor(abs / hr)} h`;
  if (abs < 30 * day) return `hace ${Math.floor(abs / day)} d`;
  if (abs < 365 * day) return `hace ${Math.floor(abs / (30 * day))} mes${Math.floor(abs / (30 * day)) === 1 ? "" : "es"}`;
  return `hace ${Math.floor(abs / (365 * day))} año${Math.floor(abs / (365 * day)) === 1 ? "" : "s"}`;
}

function expiraEn(iso: string): { texto: string; urgente: boolean } {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return { texto: "expirada", urgente: false };
  const day = 24 * 60 * 60 * 1000;
  const dias = Math.floor(diff / day);
  const horas = Math.floor((diff % day) / (60 * 60 * 1000));
  if (dias === 0) {
    return { texto: `expira en ${horas} h`, urgente: true };
  }
  return { texto: `expira en ${dias} d`, urgente: dias <= 2 };
}

export function InvitationsSection() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  // form
  const [emailNuevo, setEmailNuevo] = useState("");
  const [roleNuevo, setRoleNuevo] = useState<"admin" | "usuario">("usuario");
  const [notas, setNotas] = useState("");
  const [defaultClienteSlug, setDefaultClienteSlug] = useState<string>("");
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [savingInvite, setSavingInvite] = useState(false);
  const [resultadoInvite, setResultadoInvite] = useState<
    | { invitation: Invitation; emailSent: boolean; emailReason?: string }
    | null
  >(null);
  const [copiadoUrl, setCopiadoUrl] = useState<string | null>(null);

  // Cargar lista de clientes activos para el dropdown (una vez).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/clientes");
        const json = await r.json();
        if (json.data?.rows) setClientes(json.data.rows as ClienteOpcion[]);
      } catch {
        /* ignore — el select queda vacio y el usuario invita sin cliente */
      }
    })();
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = showArchived
        ? "/api/v1/admin/invitations?includeArchived=true"
        : "/api/v1/admin/invitations";
      const r = await fetch(url);
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else setInvitations(json.data.rows as Invitation[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const crearInvitacion = async () => {
    if (!emailNuevo.trim()) return;
    setSavingInvite(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailNuevo.trim().toLowerCase(),
          role: roleNuevo,
          notas: notas.trim() || null,
          defaultClienteSlug: defaultClienteSlug || null,
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        setResultadoInvite(json.data);
        setEmailNuevo("");
        setNotas("");
        setDefaultClienteSlug("");
        cargar();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingInvite(false);
    }
  };

  const revocar = async (id: string, email: string) => {
    if (!confirm(`Revocar la invitacion a ${email}? El link va a dejar de funcionar.`)) return;
    try {
      await fetch(`/api/v1/admin/invitations/${id}`, { method: "DELETE" });
      cargar();
    } catch (e) {
      setError(String(e));
    }
  };

  const archivar = async (id: string) => {
    try {
      await fetch(`/api/v1/admin/invitations/${id}/archive`, { method: "POST" });
      cargar();
    } catch (e) {
      setError(String(e));
    }
  };

  const desarchivar = async (id: string) => {
    try {
      await fetch(`/api/v1/admin/invitations/${id}/archive`, { method: "DELETE" });
      cargar();
    } catch (e) {
      setError(String(e));
    }
  };

  const copiar = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiadoUrl(url);
      setTimeout(() => setCopiadoUrl(null), 1800);
    } catch {
      /* ignore */
    }
  };

  const pendientes = useMemo(
    () => invitations.filter((i) => estadoDe(i) === "pendiente" && !i.archivedAt),
    [invitations],
  );

  const historial = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invitations
      .filter((i) => {
        const est = estadoDe(i);
        if (est === "pendiente") return false;
        if (!showArchived && i.archivedAt) return false;
        if (q && !i.email.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [invitations, search, showArchived]);

  const archivadasCount = useMemo(
    () => invitations.filter((i) => i.archivedAt).length,
    [invitations],
  );

  return (
    <div className="space-y-6">
      {/* ============================ CREAR ============================ */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <header className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <Plus className="w-4 h-4 text-brand-700" />
            </div>
            Nueva invitacion
          </h3>
          <p className="text-xs text-slate-500 mt-1 ml-10">
            Genera un link de acceso unico para un usuario nuevo. El link expira en 7 dias.
          </p>
        </header>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email del invitado
              </label>
              <input
                type="email"
                value={emailNuevo}
                onChange={(e) => setEmailNuevo(e.target.value)}
                placeholder="cliente@empresa.com"
                className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && emailNuevo.trim()) void crearInvitacion();
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Rol
              </label>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-md">
                <RoleButton
                  active={roleNuevo === "usuario"}
                  onClick={() => setRoleNuevo("usuario")}
                  icon={UserIcon}
                  label="Usuario"
                />
                <RoleButton
                  active={roleNuevo === "admin"}
                  onClick={() => setRoleNuevo("admin")}
                  icon={Shield}
                  label="Admin"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              Cliente por defecto
              <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <select
              value={defaultClienteSlug}
              onChange={(e) => setDefaultClienteSlug(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white transition-colors"
            >
              <option value="">— Sin preferencia — el invitado la elige despues —</option>
              {clientes.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {defaultClienteSlug && (
              <p className="text-[11px] text-slate-500 mt-1 ml-0.5">
                Cuando acepte la invitacion, aterrizara directo en el Benchmark de{" "}
                <span className="font-semibold text-slate-700">
                  {clientes.find((c) => c.slug === defaultClienteSlug)?.nombre ?? defaultClienteSlug}
                </span>
                . Puede cambiarlo desde Mi perfil.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Notas <span className="text-slate-400 font-normal">(opcional, solo visible para admins)</span>
            </label>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: Cliente piloto, area finanzas"
              className="w-full h-10 px-3 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
            />
          </div>

          {/* Ayuda colapsable */}
          <div className="border border-sky-200 bg-sky-50/50 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setAyudaAbierta((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100/50 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Como funciona
              </span>
              {ayudaAbierta ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {ayudaAbierta && (
              <ol className="list-decimal list-inside space-y-1 px-4 py-3 text-xs text-sky-900 border-t border-sky-200">
                <li>Ingresa email + rol y clickea &quot;Enviar invitacion&quot;.</li>
                <li>Si SMTP/Resend esta configurado, el email llega automatico. Sino, copias el link y lo mandas por WhatsApp, Slack o el canal que uses.</li>
                <li>El link es de un solo uso y expira en 7 dias.</li>
                <li>El invitado crea su contrasena y entra con el rol que le diste.</li>
                <li>Si necesitas revocarla antes que la use, usa el boton revocar abajo — el link deja de funcionar al instante.</li>
              </ol>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={crearInvitacion}
              disabled={!emailNuevo.trim() || savingInvite}
              className="px-4 h-10 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-md shadow-sm inline-flex items-center gap-1.5 transition-colors"
            >
              {savingInvite ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Enviar invitacion
            </button>
          </div>

          {/* Resultado creacion */}
          {resultadoInvite && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-900">
                      Invitacion creada para {resultadoInvite.invitation.email}
                    </p>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      {resultadoInvite.emailSent
                        ? "Email enviado. Deberia llegar en ~1 minuto."
                        : `Email no enviado (${resultadoInvite.emailReason ?? "sin proveedor configurado"}). Copia el link manualmente:`}
                    </p>
                    {resultadoInvite.invitation.defaultClienteSlug && (
                      <p className="text-xs text-emerald-700 mt-1 inline-flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Al aceptar, aterrizara en{" "}
                        <span className="font-semibold">
                          {clientes.find((c) => c.slug === resultadoInvite.invitation.defaultClienteSlug)?.nombre
                            ?? resultadoInvite.invitation.defaultClienteSlug}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setResultadoInvite(null)}
                  className="text-emerald-700 hover:text-emerald-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1 bg-white border border-emerald-200 rounded px-2 py-1.5">
                <code className="flex-1 text-xs font-mono text-slate-700 truncate">
                  {resultadoInvite.invitation.url}
                </code>
                <button
                  type="button"
                  onClick={() => copiar(resultadoInvite.invitation.url)}
                  className="text-xs px-2.5 h-7 bg-emerald-600 hover:bg-emerald-700 text-white rounded inline-flex items-center gap-1 transition-colors"
                >
                  {copiadoUrl === resultadoInvite.invitation.url ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copiar
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded flex items-start gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </section>

      {/* ============================ PENDIENTES ============================ */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-700" />
            </div>
            Pendientes
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
              {pendientes.length}
            </span>
          </h3>
        </div>
        {loading ? (
          <div className="text-xs text-slate-500 py-8 text-center bg-white border border-slate-200 rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
          </div>
        ) : pendientes.length === 0 ? (
          <div className="text-xs text-slate-500 py-8 text-center bg-slate-50/50 border border-dashed border-slate-300 rounded-lg">
            <Mail className="w-6 h-6 text-slate-300 mx-auto mb-1" />
            No hay invitaciones pendientes.
          </div>
        ) : (
          <div className="space-y-2">
            {pendientes.map((inv) => (
              <PendienteCard
                key={inv.id}
                inv={inv}
                onCopiar={copiar}
                onRevocar={revocar}
                copiadoUrl={copiadoUrl}
              />
            ))}
          </div>
        )}
      </section>

      {/* ============================ HISTORIAL ============================ */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <UserCheck className="w-4 h-4 text-slate-700" />
            </div>
            Historial
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
              {historial.length}
            </span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por email..."
                className="h-8 pl-8 pr-2 text-xs rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors w-52"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border transition-colors",
                showArchived
                  ? "bg-brand-50 border-brand-200 text-brand-800 hover:bg-brand-100"
                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50",
              )}
              title={showArchived ? "Ocultar archivadas" : "Ver archivadas"}
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? "Ocultar archivadas" : `Ver archivadas${archivadasCount > 0 ? ` (${archivadasCount})` : ""}`}
            </button>
          </div>
        </div>

        {historial.length === 0 ? (
          <div className="text-xs text-slate-500 py-8 text-center bg-slate-50/50 border border-dashed border-slate-300 rounded-lg">
            {search ? (
              <>Sin resultados para <span className="font-mono">{search}</span></>
            ) : (
              <>Sin invitaciones en el historial.</>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Invitado</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Rol</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Estado</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Invito</th>
                  <th className="text-left px-3 py-2.5 font-semibold">Cuando</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historial.map((inv) => (
                  <HistorialRow
                    key={inv.id}
                    inv={inv}
                    onArchivar={archivar}
                    onDesarchivar={desarchivar}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RoleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof UserIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 h-8 px-2 text-xs font-medium rounded inline-flex items-center justify-center gap-1 transition-colors",
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:text-slate-900",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function PendienteCard({
  inv,
  onCopiar,
  onRevocar,
  copiadoUrl,
}: {
  inv: Invitation;
  onCopiar: (url: string) => void;
  onRevocar: (id: string, email: string) => void;
  copiadoUrl: string | null;
}) {
  const exp = expiraEn(inv.expiresAt);
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-slate-300 transition-colors">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Mail className="w-4 h-4 text-slate-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900 truncate">{inv.email}</p>
            <RoleBadge role={inv.role} />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 flex-wrap">
            <span className={cn("inline-flex items-center gap-1", exp.urgente && "text-amber-700 font-medium")}>
              <Clock className="w-3 h-3" />
              {exp.texto}
            </span>
            {inv.invitedByName && (
              <span className="inline-flex items-center gap-1">
                <UserIcon className="w-3 h-3" />
                Por {inv.invitedByName}
              </span>
            )}
            {inv.notas && (
              <span className="text-slate-500 italic truncate">&quot;{inv.notas}&quot;</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => onCopiar(inv.url)}
          className="text-xs px-2.5 h-8 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1 transition-colors"
          title="Copiar link de invitacion"
        >
          {copiadoUrl === inv.url ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copiar link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => onRevocar(inv.id, inv.email)}
          className="text-xs px-2.5 h-8 bg-white border border-slate-300 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 rounded-md inline-flex items-center gap-1 transition-colors"
          title="Revocar invitacion"
        >
          <MailX className="w-3.5 h-3.5" />
          Revocar
        </button>
      </div>
    </div>
  );
}

function HistorialRow({
  inv,
  onArchivar,
  onDesarchivar,
}: {
  inv: Invitation;
  onArchivar: (id: string) => void;
  onDesarchivar: (id: string) => void;
}) {
  const estado = estadoDe(inv) as EstadoHistorial;
  const fecha = inv.acceptedAt || inv.revokedAt || inv.expiresAt;
  const archivada = Boolean(inv.archivedAt);

  return (
    <tr className={cn("hover:bg-slate-50 transition-colors", archivada && "opacity-50")}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-slate-800 truncate">{inv.email}</span>
          {archivada && (
            <Archive className="w-3 h-3 text-slate-400" aria-label="Archivada" />
          )}
        </div>
        {inv.notas && (
          <p className="text-[10px] text-slate-500 italic truncate mt-0.5">&quot;{inv.notas}&quot;</p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <RoleBadge role={inv.role} />
      </td>
      <td className="px-3 py-2.5">
        <EstadoBadge estado={estado} />
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-600 truncate max-w-[140px]">
        {inv.invitedByName ?? "—"}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-500" title={new Date(fecha).toLocaleString("es-PE")}>
        {tiempoRelativo(fecha)}
      </td>
      <td className="px-4 py-2.5 text-right">
        {archivada ? (
          <button
            type="button"
            onClick={() => onDesarchivar(inv.id)}
            className="text-[11px] px-2 h-7 bg-white border border-slate-300 hover:bg-slate-50 rounded inline-flex items-center gap-1 transition-colors"
            title="Restaurar del archivo"
          >
            <ArchiveRestore className="w-3 h-3" />
            Restaurar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onArchivar(inv.id)}
            className="text-[11px] px-2 h-7 bg-white border border-slate-300 hover:bg-slate-50 rounded inline-flex items-center gap-1 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Archivar (ocultar del historial)"
          >
            <Archive className="w-3 h-3" />
            Archivar
          </button>
        )}
      </td>
    </tr>
  );
}

function RoleBadge({ role }: { role: "admin" | "usuario" }) {
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider inline-flex items-center gap-1",
        role === "admin"
          ? "bg-violet-100 text-violet-800 border border-violet-200"
          : "bg-slate-100 text-slate-700 border border-slate-200",
      )}
    >
      {role === "admin" ? <Shield className="w-2.5 h-2.5" /> : <UserIcon className="w-2.5 h-2.5" />}
      {role}
    </span>
  );
}

function EstadoBadge({ estado }: { estado: EstadoHistorial }) {
  const config = {
    aceptada: { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2, label: "Aceptada" },
    revocada: { color: "bg-slate-100 text-slate-700 border-slate-200", icon: RotateCcw, label: "Revocada" },
    expirada: { color: "bg-amber-100 text-amber-800 border-amber-200", icon: XCircle, label: "Expirada" },
  }[estado];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider inline-flex items-center gap-1 border",
        config.color,
      )}
    >
      <Icon className="w-2.5 h-2.5" />
      {config.label}
    </span>
  );
}
