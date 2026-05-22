"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Mail,
  MailX,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type Invitation = {
  id: string;
  token: string;
  email: string;
  role: "admin" | "usuario";
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  notas: string | null;
  createdAt: string;
  url: string;
};

export function InvitationsSection() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form
  const [emailNuevo, setEmailNuevo] = useState("");
  const [roleNuevo, setRoleNuevo] = useState<"admin" | "usuario">("usuario");
  const [notas, setNotas] = useState("");
  const [savingInvite, setSavingInvite] = useState(false);
  const [resultadoInvite, setResultadoInvite] = useState<
    | { invitation: Invitation; emailSent: boolean; emailReason?: string }
    | null
  >(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/invitations");
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else setInvitations(json.data.rows as Invitation[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        setResultadoInvite(json.data);
        setEmailNuevo("");
        setNotas("");
        cargar();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingInvite(false);
    }
  };

  const revocar = async (id: string) => {
    if (!confirm("Revocar esta invitacion? El link va a dejar de funcionar.")) return;
    try {
      await fetch(`/api/v1/admin/invitations/${id}`, { method: "DELETE" });
      cargar();
    } catch (e) {
      setError(String(e));
    }
  };

  const copiar = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const pendientes = invitations.filter(
    (i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date(),
  );
  const historial = invitations.filter(
    (i) => i.acceptedAt || i.revokedAt || new Date(i.expiresAt) <= new Date(),
  );

  return (
    <div className="space-y-5">
      {/* Crear invitacion */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Plus className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">Crear invitacion</h3>
        </header>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={emailNuevo}
                onChange={(e) => setEmailNuevo(e.target.value)}
                placeholder="cliente@empresa.com"
                className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Rol
              </label>
              <select
                value={roleNuevo}
                onChange={(e) => setRoleNuevo(e.target.value as "admin" | "usuario")}
                className="w-full h-9 px-3 text-sm rounded border border-slate-300 bg-white"
              >
                <option value="usuario">Usuario</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notas (opcional)
            </label>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: Cliente piloto, area finanzas"
              className="w-full h-9 px-3 text-sm rounded border border-slate-300"
            />
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={crearInvitacion}
              disabled={!emailNuevo.trim() || savingInvite}
              className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1.5"
            >
              {savingInvite ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Crear invitacion
            </button>
          </div>

          {/* Resultado: muestra el link copiable + estado del email */}
          {resultadoInvite && (
            <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-900">
                      Invitacion creada para{" "}
                      <span className="font-mono">{resultadoInvite.invitation.email}</span>
                    </p>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      {resultadoInvite.emailSent ? (
                        <>📧 Email enviado correctamente.</>
                      ) : (
                        <>
                          ⚠️ Email no configurado ({resultadoInvite.emailReason ?? "sin api key"}).
                          Copia el link y compartilo manualmente:
                        </>
                      )}
                    </p>
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
                  className="text-xs px-2 h-7 bg-emerald-600 hover:bg-emerald-700 text-white rounded inline-flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Copiar
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 flex items-start gap-1">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      </section>

      {/* Pendientes */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-amber-600" />
          Invitaciones pendientes
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
            {pendientes.length}
          </span>
        </h3>
        {loading ? (
          <div className="text-xs text-slate-500 py-4 text-center">Cargando...</div>
        ) : pendientes.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center bg-slate-50 border border-slate-200 rounded">
            Sin invitaciones pendientes.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Email</th>
                  <th className="text-left px-3 py-2 font-semibold">Rol</th>
                  <th className="text-left px-3 py-2 font-semibold">Expira</th>
                  <th className="text-right px-3 py-2 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendientes.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-900 truncate">
                      <Mail className="w-3 h-3 inline mr-1 text-slate-400" />
                      {inv.email}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider",
                          inv.role === "admin"
                            ? "bg-violet-100 text-violet-700"
                            : "bg-slate-200 text-slate-700",
                        )}
                      >
                        {inv.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {new Date(inv.expiresAt).toLocaleDateString("es-PE")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copiar(inv.url)}
                          className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-slate-50 rounded inline-flex items-center gap-1"
                          title="Copiar link"
                        >
                          <Copy className="w-3 h-3" />
                          Copiar
                        </button>
                        <button
                          type="button"
                          onClick={() => revocar(inv.id)}
                          className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 rounded inline-flex items-center gap-1"
                          title="Revocar"
                        >
                          <MailX className="w-3 h-3" />
                          Revocar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Historial */}
      {historial.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
            Historial
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
              {historial.length}
            </span>
          </h3>
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Email</th>
                  <th className="text-left px-3 py-2 font-semibold">Estado</th>
                  <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historial.slice(0, 25).map((inv) => {
                  const estado = inv.acceptedAt
                    ? "aceptada"
                    : inv.revokedAt
                      ? "revocada"
                      : "expirada";
                  const fecha = inv.acceptedAt || inv.revokedAt || inv.expiresAt;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50 opacity-60">
                      <td className="px-3 py-2 text-slate-700 truncate">{inv.email}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider",
                            estado === "aceptada"
                              ? "bg-emerald-100 text-emerald-700"
                              : estado === "revocada"
                                ? "bg-slate-200 text-slate-700"
                                : "bg-amber-100 text-amber-700",
                          )}
                        >
                          {estado}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {new Date(fecha).toLocaleDateString("es-PE")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
