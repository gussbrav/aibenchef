"use client";

import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Save,
  Send,
  Server,
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

type KeyGroup = {
  titulo: string;
  icon: typeof SettingsIcon;
  descripcion: string;
  keys: string[];
  testable?: boolean;
  ayuda?: { titulo: string; items: Array<string | React.ReactNode> };
};

const KEY_GROUPS: KeyGroup[] = [
  {
    titulo: "Email (SMTP — Gmail / Zoho / Outlook)",
    icon: Server,
    descripcion:
      "Envio nativo via SMTP. Recomendado si ya tenes una casilla Gmail (con app password), Zoho (dominio propio) u Outlook. Tiene prioridad sobre Resend si esta activo.",
    keys: [
      "smtp_enabled",
      "smtp_host",
      "smtp_port",
      "smtp_secure",
      "smtp_user",
      "smtp_password",
      "smtp_from",
    ],
    testable: true,
    ayuda: {
      titulo: "Como configurar:",
      items: [
        "Gmail: host=smtp.gmail.com, port=587, secure=false. Generar app password en https://myaccount.google.com/apppasswords (no usar la contraseña normal).",
        "Zoho: host=smtppro.zoho.com, port=587, secure=false. Activar SMTP en Settings -> Mail Accounts -> IMAP/POP.",
        "Outlook 365: host=smtp.office365.com, port=587, secure=false.",
        "smtp_from puede ser el mismo email (Gmail) o un alias verificado (Zoho).",
        "Marca smtp_enabled = true y prueba con 'Enviar email de prueba' abajo.",
      ],
    },
  },
  {
    titulo: "Email (Resend) — alternativa",
    icon: Mail,
    descripcion:
      "Envio via Resend (HTTP API, no requiere SMTP). Util si no querés mantener credenciales SMTP propias. Solo se usa si SMTP no esta habilitado.",
    keys: ["email_resend_enabled", "email_resend_api_key", "email_resend_from"],
    ayuda: {
      titulo: "Como configurar:",
      items: [
        "Crea una cuenta gratis en https://resend.com (100 emails/dia free).",
        "Verifica tu dominio en Resend (paneles -> Domains) para poder enviar desde invitaciones@tu-dominio.com.",
        "Crea una API key en Resend (paneles -> API Keys).",
        "Pega API key + from email + marca enabled = true.",
        "Si SMTP esta activo, Resend se ignora — es el fallback.",
      ],
    },
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
                <header className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <Icon className="w-4 h-4 text-slate-600" />
                      {group.titulo}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">{group.descripcion}</p>
                  </div>
                  {group.testable && <TestEmailButton />}
                </header>
                <div className="p-4 space-y-3">
                  {group.keys.map((key) => {
                    const s = byKey(key);
                    if (!s) return null;
                    return <SettingRow key={key} setting={s} onSaved={cargar} />;
                  })}
                  {group.ayuda && (
                    <div className="p-3 bg-sky-50 border border-sky-200 rounded text-xs text-sky-900 space-y-1.5 mt-3">
                      <p className="font-semibold">{group.ayuda.titulo}</p>
                      <ol className="list-decimal list-inside space-y-0.5 ml-1">
                        {group.ayuda.items.map((it, i) => (
                          <li key={i}>{it}</li>
                        ))}
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

function TestEmailButton() {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(
    null,
  );

  const enviar = async () => {
    if (!to.trim()) return;
    setEnviando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/v1/admin/system-settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim() }),
      });
      const j = await r.json();
      if (j.error) {
        setResultado({ ok: false, mensaje: j.error.message ?? "Error" });
      } else {
        const provider = j.data?.provider ?? "?";
        setResultado(
          j.data?.sent
            ? {
                ok: true,
                mensaje: `Enviado via ${provider}. Revisa la bandeja de ${to}.`,
              }
            : {
                ok: false,
                mensaje: `Fallo (${provider}): ${j.data?.reason ?? "sin detalle"}`,
              },
        );
      }
    } catch (e) {
      setResultado({ ok: false, mensaje: String(e) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 h-7 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded"
      >
        <Send className="w-3 h-3" />
        Enviar email de prueba
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-80 bg-white border border-slate-200 rounded-lg shadow-lg p-3 space-y-2">
          <p className="text-[11px] text-slate-600">
            Manda un email de prueba con la configuracion guardada. Util para
            verificar credenciales SMTP antes de enviar invitaciones reales.
          </p>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="tu@correo.com"
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 focus:border-brand-500 outline-none"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !to.trim()}
              className="inline-flex items-center gap-1 px-2.5 h-7 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
            >
              {enviando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Probar
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setResultado(null);
                setTo("");
              }}
              className="px-2 h-7 text-xs text-slate-600 hover:text-slate-900"
            >
              Cerrar
            </button>
          </div>
          {resultado && (
            <div
              className={cn(
                "px-2 py-1.5 rounded text-[11px] border",
                resultado.ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800",
              )}
            >
              {resultado.mensaje}
            </div>
          )}
        </div>
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
    .replace(/^smtp_/, "")
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
