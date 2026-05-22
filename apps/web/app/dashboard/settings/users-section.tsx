"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Crown,
  Loader2,
  Mail,
  PauseCircle,
  Shield,
  Trash2,
  UserIcon,
  Users as UsersIcon,
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

  const patchUser = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const eliminar = async (u: AppUser) => {
    if (!confirm(`Eliminar a ${u.name || u.email}? Sus sesiones, tableros y notebooks tambien se borraran (cascade).`))
      return;
    setBusyId(u.id);
    setError(null);
    try {
      const r = await fetch(`/api/v1/admin/users/${u.id}`, { method: "DELETE" });
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
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
          <strong>Como invitar:</strong> compartile el link{" "}
          <code className="font-mono bg-white px-1 py-0.5 rounded">
            {typeof window !== "undefined" ? window.location.origin : ""}/signup
          </code>{" "}
          y se va a registrar. Despues asignale el rol que quieras desde aqui.
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
          {error}
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
                      <div className="inline-flex items-center gap-1">
                        {u.role === "usuario" ? (
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { role: "admin" })}
                            disabled={isBusy || esYo}
                            title={esYo ? "No podes cambiar tu propio rol" : "Promover a admin"}
                            className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-violet-50 hover:border-violet-300 disabled:opacity-30 rounded inline-flex items-center gap-1"
                          >
                            <Crown className="w-3 h-3" />
                            Promover
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { role: "usuario" })}
                            disabled={isBusy || esYo}
                            title={esYo ? "No podes demotar tu propio rol" : "Demotar a usuario"}
                            className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-30 rounded inline-flex items-center gap-1"
                          >
                            <Shield className="w-3 h-3" />
                            Demotar
                          </button>
                        )}
                        {u.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { status: "suspended" })}
                            disabled={isBusy || esYo}
                            title={esYo ? "No podes suspender tu propia cuenta" : "Suspender"}
                            className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-amber-50 hover:border-amber-300 disabled:opacity-30 rounded inline-flex items-center gap-1"
                          >
                            <PauseCircle className="w-3 h-3" />
                            Suspender
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => patchUser(u.id, { status: "active" })}
                            disabled={isBusy}
                            className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-30 rounded inline-flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            Activar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => eliminar(u)}
                          disabled={isBusy || esYo}
                          title={esYo ? "No podes eliminar tu propia cuenta" : "Eliminar"}
                          className="text-xs px-2 h-7 bg-white border border-slate-300 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 disabled:opacity-30 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
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
