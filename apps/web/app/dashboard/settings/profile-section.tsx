"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Loader2, Mail, Save, User as UserIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { authClient } from "@/lib/auth/client";

type Me = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  role: "admin" | "usuario";
  status: "active" | "suspended" | "invited";
  defaultClienteSlug: string | null;
  createdAt: string;
};

type ClienteOpcion = { slug: string; nombre: string; nombreCorto: string };

export function ProfileSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/me");
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else setMe(json.data as Me);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Cargando perfil...
      </div>
    );
  }
  if (!me) {
    return (
      <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
        {error ?? "No se pudo cargar tu perfil"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Mi perfil</h2>
        <p className="text-sm text-slate-600 mt-1">
          Edita tu informacion personal y cambia tu contrasena.
        </p>
      </div>

      <NameForm me={me} onSaved={cargar} />
      <DefaultClienteForm me={me} onSaved={cargar} />
      <PasswordForm />

      <section className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-600 space-y-1">
        <div className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-mono">{me.email}</span>
          {me.emailVerified ? (
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium uppercase">
              Verificado
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium uppercase">
              No verificado
            </span>
          )}
        </div>
        <p>
          Rol:{" "}
          <span
            className={cn(
              "font-mono px-1.5 py-0.5 rounded text-[10px] uppercase",
              me.role === "admin"
                ? "bg-violet-100 text-violet-700"
                : "bg-slate-200 text-slate-700",
            )}
          >
            {me.role}
          </span>{" "}
          · Status: <span className="font-mono">{me.status}</span> · Desde{" "}
          {new Date(me.createdAt).toLocaleDateString("es-PE")}
        </p>
      </section>
    </div>
  );
}

function NameForm({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const guardar = async () => {
    if (!name.trim() || name.trim() === me.name) return;
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      const r = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await r.json();
      if (json.error) setErr(json.error.message ?? "Error");
      else {
        setOk(true);
        onSaved();
        setTimeout(() => setOk(false), 2500);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <UserIcon className="w-4 h-4 text-slate-500" />
        Nombre
      </h3>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
          placeholder="Tu nombre"
        />
        <button
          type="button"
          onClick={guardar}
          disabled={saving || !name.trim() || name.trim() === me.name}
          className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : ok ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {ok ? "Guardado" : "Guardar"}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {err}
        </p>
      )}
    </section>
  );
}

function DefaultClienteForm({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [clientes, setClientes] = useState<ClienteOpcion[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<string>(me.defaultClienteSlug ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/clientes");
        const json = await r.json();
        if (json.data?.rows) setClientes(json.data.rows as ClienteOpcion[]);
      } catch {
        /* ignore */
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  const guardar = async () => {
    if (selected === (me.defaultClienteSlug ?? "")) return;
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      const r = await fetch("/api/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultClienteSlug: selected === "" ? null : selected,
        }),
      });
      const json = await r.json();
      if (json.error) setErr(json.error.message ?? "Error");
      else {
        setOk(true);
        onSaved();
        setTimeout(() => setOk(false), 2500);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const cambio = selected !== (me.defaultClienteSlug ?? "");

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-500" />
        Cliente por defecto
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Al abrir el Benchmark aterrizas directo en este cliente. Podes navegar a
        otros libremente desde la barra superior o via URL.
      </p>
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={loadingList}
          className="flex-1 h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white transition-colors"
        >
          <option value="">Sin preferencia (default global)</option>
          {clientes.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.nombre}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={guardar}
          disabled={saving || !cambio}
          className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : ok ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {ok ? "Guardado" : "Guardar"}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {err}
        </p>
      )}
    </section>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const cambiar = async () => {
    setErr(null);
    setOk(false);
    if (newPassword.length < 8) {
      setErr("La nueva contrasena debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== newPassword2) {
      setErr("Las contrasenas no coinciden");
      return;
    }
    setSaving(true);
    try {
      const { error } = await authClient.changePassword({
        newPassword,
        currentPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        setErr(error.message ?? "Error al cambiar contrasena");
      } else {
        setOk(true);
        setCurrentPassword("");
        setNewPassword("");
        setNewPassword2("");
        setTimeout(() => setOk(false), 3000);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">Cambiar contrasena</h3>
      <p className="text-xs text-slate-500 mb-3">
        Al cambiarla, se cerraran tus otras sesiones activas por seguridad.
      </p>
      <div className="space-y-2">
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Contrasena actual"
          autoComplete="current-password"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Nueva contrasena (min 8 caracteres)"
          autoComplete="new-password"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
        />
        <input
          type="password"
          value={newPassword2}
          onChange={(e) => setNewPassword2(e.target.value)}
          placeholder="Confirmar nueva contrasena"
          autoComplete="new-password"
          className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
        />
      </div>
      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={cambiar}
          disabled={saving || !currentPassword || !newPassword}
          className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : ok ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {ok ? "Cambiada" : "Cambiar contrasena"}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {err}
        </p>
      )}
    </section>
  );
}
