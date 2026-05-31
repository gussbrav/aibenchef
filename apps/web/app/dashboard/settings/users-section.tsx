"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Crown,
  Edit3,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Mail,
  MoreVertical,
  PauseCircle,
  Send,
  Shield,
  Trash2,
  UserIcon,
  Users as UsersIcon,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type AppUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: "admin" | "usuario";
  status: "active" | "suspended" | "invited";
  createdAt: string;
};

export function UsersSection({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Modales
  const [editando, setEditando] = useState<AppUser | null>(null);
  const [linkReset, setLinkReset] = useState<{ user: AppUser; url: string } | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "err"; mensaje: string } | null>(
    null,
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/users");
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else setUsers(json.data.rows as AppUser[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const callApi = async (
    id: string,
    path: string,
    method: "PATCH" | "POST" | "DELETE",
    body?: unknown,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/users/${id}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await r.json().catch(() => ({}));
      if (json.error) {
        setError(json.error.message ?? "Error");
        return null;
      }
      return json.data;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const cambiarRol = async (u: AppUser, role: "admin" | "usuario") => {
    const ok = await callApi(u.id, "", "PATCH", { role });
    if (ok) cargar();
  };

  const cambiarStatus = async (u: AppUser, status: "active" | "suspended") => {
    const ok = await callApi(u.id, "", "PATCH", { status });
    if (ok) cargar();
  };

  const eliminar = async (u: AppUser) => {
    if (
      !confirm(
        `Eliminar a ${u.name || u.email}? Sus sesiones, tableros y notebooks tambien se borraran (cascade).`,
      )
    )
      return;
    const ok = await callApi(u.id, "", "DELETE");
    if (ok) cargar();
  };

  const renombrar = async (u: AppUser, nombre: string) => {
    const ok = await callApi(u.id, "/rename", "PATCH", { name: nombre });
    if (ok) {
      cargar();
      setEditando(null);
    }
  };

  const generarLinkReset = async (u: AppUser) => {
    const data = await callApi(u.id, "/reset-password-link", "POST");
    if (data?.url) setLinkReset({ user: u, url: data.url });
  };

  const reenviarInvitacion = async (u: AppUser) => {
    const data = await callApi(u.id, "/resend-invitation", "POST");
    if (data) {
      setFeedback(
        data.emailSent
          ? {
              tipo: "ok",
              mensaje: `Invitacion re-enviada a ${u.email}.`,
            }
          : {
              tipo: "err",
              mensaje: `No se pudo enviar: ${data.emailReason ?? "sin detalle"}`,
            },
      );
      setTimeout(() => setFeedback(null), 4500);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <UsersIcon className="w-5 h-5 text-slate-600" />
          Usuarios
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Gestiona quien puede acceder y con que rol. Los <strong>admins</strong> pueden
          editar configuracion, gestionar usuarios y ver auditoria. Los{" "}
          <strong>usuarios</strong> solo pueden usar las funcionalidades analiticas.
        </p>
        <div className="bg-sky-50 border border-sky-200 rounded p-3 mt-3 text-xs text-sky-900">
          <strong>Como invitar:</strong> usa la pestaña <em>Invitaciones</em> arriba —
          se manda un email con un link de signup pre-aprobado. Despues, desde aqui
          podes editar nombre, rol, status o emitir un link de reset de contraseña.
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
          {error}
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "p-3 rounded text-sm border flex items-start justify-between gap-2",
            feedback.tipo === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800",
          )}
        >
          <span>{feedback.mensaje}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando usuarios...
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Usuario</th>
                <th className="text-left px-4 py-2.5 font-semibold">Rol</th>
                <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                <th className="text-left px-4 py-2.5 font-semibold">Alta</th>
                <th className="text-right px-4 py-2.5 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const esYo = u.id === currentUserId;
                const isBusy = busyId === u.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(u.name || u.email)
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase() || "?"}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate flex items-center gap-1">
                            {u.name || "(sin nombre)"}
                            {esYo && (
                              <span className="text-[10px] px-1 py-0.5 bg-slate-200 text-slate-600 rounded font-medium uppercase">
                                tu
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {u.email}
                            {!u.emailVerified && (
                              <span className="text-[10px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-medium uppercase">
                                no verif
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium uppercase tracking-wider",
                          u.role === "admin"
                            ? "bg-violet-100 text-violet-700"
                            : "bg-slate-200 text-slate-700",
                        )}
                      >
                        {u.role === "admin" ? (
                          <Crown className="w-3 h-3" />
                        ) : (
                          <UserIcon className="w-3 h-3" />
                        )}
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium uppercase tracking-wider",
                          u.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : u.status === "suspended"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {u.status === "active" ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <PauseCircle className="w-3 h-3" />
                        )}
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString("es-PE")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionsMenu
                        user={u}
                        isMe={esYo}
                        isBusy={isBusy}
                        onEdit={() => setEditando(u)}
                        onResetPassword={() => generarLinkReset(u)}
                        onResendInvitation={() => reenviarInvitacion(u)}
                        onChangeRole={(role) => cambiarRol(u, role)}
                        onChangeStatus={(status) => cambiarStatus(u, status)}
                        onDelete={() => eliminar(u)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <EditUserModal
          user={editando}
          onCancel={() => setEditando(null)}
          onSave={(name) => renombrar(editando, name)}
        />
      )}

      {linkReset && (
        <ResetLinkModal
          user={linkReset.user}
          url={linkReset.url}
          onClose={() => setLinkReset(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Menu de acciones (kebab) — replica el patron del CRM Palma Rio.
// =============================================================================
function ActionsMenu({
  user,
  isMe,
  isBusy,
  onEdit,
  onResetPassword,
  onResendInvitation,
  onChangeRole,
  onChangeStatus,
  onDelete,
}: {
  user: AppUser;
  isMe: boolean;
  isBusy: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onResendInvitation: () => void;
  onChangeRole: (role: "admin" | "usuario") => void;
  onChangeStatus: (status: "active" | "suspended") => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    opts?: { destructive?: boolean; disabled?: boolean; tooltip?: string },
  ) => (
    <button
      type="button"
      onClick={() => {
        if (opts?.disabled) return;
        setOpen(false);
        onClick();
      }}
      disabled={opts?.disabled}
      title={opts?.tooltip}
      className={cn(
        "w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed",
        opts?.destructive && "text-rose-700 hover:bg-rose-50",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isBusy}
        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
        aria-label="Mas acciones"
      >
        {isBusy ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
        ) : (
          <MoreVertical className="w-4 h-4 text-slate-500" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {isMe ? (
            <p className="px-3 py-2 text-[11px] text-slate-500">
              Editas tu propio perfil desde la pestaña <strong>Mi perfil</strong>.
            </p>
          ) : (
            <>
              {item(<Edit3 className="w-3.5 h-3.5" />, "Editar datos", onEdit)}
              {item(
                <KeyRound className="w-3.5 h-3.5" />,
                "Copiar URL de restablecimiento",
                onResetPassword,
              )}
              {!user.emailVerified &&
                item(
                  <Send className="w-3.5 h-3.5" />,
                  "Reenviar invitacion",
                  onResendInvitation,
                  {
                    tooltip:
                      "Solo funciona si todavia hay una invitacion pendiente para este email.",
                  },
                )}
              <div className="my-1 border-t border-slate-100" />
              {user.role === "usuario"
                ? item(
                    <Crown className="w-3.5 h-3.5 text-violet-600" />,
                    "Promover a admin",
                    () => onChangeRole("admin"),
                  )
                : item(
                    <Shield className="w-3.5 h-3.5" />,
                    "Demotar a usuario",
                    () => onChangeRole("usuario"),
                  )}
              {user.status === "active"
                ? item(
                    <PauseCircle className="w-3.5 h-3.5 text-amber-600" />,
                    "Suspender",
                    () => onChangeStatus("suspended"),
                  )
                : item(
                    <Check className="w-3.5 h-3.5 text-emerald-600" />,
                    "Reactivar",
                    () => onChangeStatus("active"),
                  )}
              <div className="my-1 border-t border-slate-100" />
              {item(
                <Trash2 className="w-3.5 h-3.5" />,
                "Eliminar usuario",
                onDelete,
                { destructive: true },
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Modal "Editar datos" (solo nombre — email se cambia por flujo aparte).
// =============================================================================
function EditUserModal({
  user,
  onCancel,
  onSave,
}: {
  user: AppUser;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [nombre, setNombre] = useState(user.name);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 mb-4">Editar datos</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email (no editable)
            </label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full h-9 px-3 text-sm rounded border border-slate-200 bg-slate-50 text-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nombre *
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoFocus
              maxLength={120}
              className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 h-9 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSave(nombre)}
            disabled={!nombre.trim() || nombre.trim() === user.name}
            className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Modal "Link de reset" — muestra la URL para que el admin la copie.
// =============================================================================
function ResetLinkModal({
  user,
  url,
  onClose,
}: {
  user: AppUser;
  url: string;
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* navigator.clipboard puede no estar disponible en http */
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-violet-600" />
          Link de restablecimiento generado
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Compartile este link a <strong>{user.email}</strong> por el canal que
          prefieras (WhatsApp, Slack, mail personal). Caduca en 1 hora y se puede
          usar una sola vez.
        </p>
        <div className="flex gap-2 items-center">
          <input
            readOnly
            value={url}
            className="flex-1 h-10 px-3 text-xs font-mono rounded border border-slate-300 bg-slate-50 text-slate-700"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={copiar}
            className={cn(
              "inline-flex items-center gap-1 px-3 h-10 text-xs font-medium rounded",
              copiado
                ? "bg-emerald-600 text-white"
                : "bg-brand-600 hover:bg-brand-700 text-white",
            )}
          >
            {copiado ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copiado
              </>
            ) : (
              <>
                <LinkIcon className="w-3.5 h-3.5" />
                Copiar
              </>
            )}
          </button>
        </div>
        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-9 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
