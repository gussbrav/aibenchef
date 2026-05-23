"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Save,
  Settings as SettingsIcon,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type SystemSetting = {
  key: string;
  value: string | null;
  isSecret: boolean;
  descripcion: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

const KEY_GROUPS: Array<{
  titulo: string;
  icon: typeof SettingsIcon;
  descripcion: string;
  keys: string[];
}> = [
  {
    titulo: "Email (Resend)",
    icon: Mail,
    descripcion:
      "Envio automatico de invitaciones via Resend. Sin esto, las invitaciones funcionan pero se debe copiar el link manualmente al usuario invitado.",
    keys: ["email_resend_enabled", "email_resend_api_key", "email_resend_from"],
  },
];

export function SystemSettingsSection() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/system-settings");
      const j = await r.json();
      if (j.error) {
        setError(j.error.message ?? "Error cargando settings");
      } else {
        setSettings(j.data as SystemSetting[]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const byKey = (key: string) => settings.find((s) => s.key === key);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-slate-600" />
          Configuracion del sistema
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Variables runtime de la plataforma. Los secrets se guardan encriptados con AES-256-GCM.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : (
        <>
          {KEY_GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <section
                key={group.titulo}
                className="bg-white border border-slate-200 rounded-lg overflow-hidden"
              >
                <header className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-slate-600" />
                    {group.titulo}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{group.descripcion}</p>
                </header>
                <div className="p-4 space-y-3">
                  {group.keys.map((key) => {
                    const s = byKey(key);
                    if (!s) return null;
                    return <SettingRow key={key} setting={s} onSaved={cargar} />;
                  })}
                  {group.titulo === "Email (Resend)" && (
                    <div className="p-3 bg-sky-50 border border-sky-200 rounded text-xs text-sky-900 space-y-1.5 mt-3">
                      <p className="font-semibold">Como configurar:</p>
                      <ol className="list-decimal list-inside space-y-0.5 ml-1">
                        <li>
                          Crea una cuenta gratis en <code className="font-mono bg-sky-100 px-1 rounded">https://resend.com</code> (100 emails/dia free).
                        </li>
                        <li>
                          Verifica tu dominio en Resend (paneles → Domains) para poder enviar desde <code className="font-mono bg-sky-100 px-1 rounded">invitaciones@tu-dominio.com</code>.
                        </li>
                        <li>
                          Crea una API key en Resend (paneles → API Keys).
                        </li>
                        <li>
                          Pega aca arriba: API key, from email, y marca enabled = <code className="font-mono bg-sky-100 px-1 rounded">true</code>.
                        </li>
                        <li>
                          Crea una invitacion de prueba en la pestana "Invitaciones".
                        </li>
                      </ol>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function SettingRow({
  setting,
  onSaved,
}: {
  setting: SystemSetting;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    setSaving(true);
    setErr(null);
    setOk(false);
    try {
      const r = await fetch("/api/v1/admin/system-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: setting.key, value: value.trim() || null }),
      });
      const j = await r.json();
      if (j.error) {
        setErr(j.error.message ?? "Error");
      } else {
        setOk(true);
        setValue("");
        setEditing(false);
        onSaved();
        setTimeout(() => setOk(false), 2000);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const label = setting.key
    .replace(/^email_resend_/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
      <div>
        <label className="block text-xs font-semibold text-slate-700">{label}</label>
        {setting.descripcion && (
          <p className="text-[11px] text-slate-500 mt-0.5">{setting.descripcion}</p>
        )}
      </div>
      <div className="md:col-span-2">
        {!editing ? (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex-1 px-3 h-9 inline-flex items-center text-sm font-mono rounded border",
                setting.value
                  ? "bg-slate-50 border-slate-200 text-slate-700"
                  : "bg-amber-50 border-amber-200 text-amber-700",
              )}
            >
              {setting.value || "(sin configurar)"}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-3 h-9 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded"
            >
              Editar
            </button>
            {ok && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {setting.isSecret ? (
                <div className="relative flex-1">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Pega el valor aqui"
                    className="w-full h-9 px-3 pr-9 text-sm font-mono rounded border border-slate-300 focus:border-brand-500 outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Pega el valor aqui"
                  className="flex-1 h-9 px-3 text-sm font-mono rounded border border-slate-300 focus:border-brand-500 outline-none"
                  autoFocus
                />
              )}
              <button
                type="button"
                onClick={guardar}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 h-9 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setErr(null);
                }}
                className="px-3 h-9 text-xs text-slate-600 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>
            {err && (
              <div className="px-2 py-1 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {err}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
