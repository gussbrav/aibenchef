"use client";

import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Info,
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

type FieldType = "toggle" | "password" | "number" | "email" | "text";

type KeyGroup = {
  titulo: string;
  icon: typeof SettingsIcon;
  descripcion: string;
  /**
   * Key del setting que controla si esta seccion esta activa.
   * Se destaca al tope como toggle prominente + su estado da el badge Activo/Inactivo.
   */
  enabledKey?: string;
  keys: string[];
  testable?: boolean;
  ayuda?: { titulo: string; items: Array<string | React.ReactNode> };
};

/**
 * Labels amigables por key — evita mostrar "smtp_from" al usuario final.
 */
const FRIENDLY_LABEL: Record<string, string> = {
  smtp_enabled: "Envio SMTP habilitado",
  smtp_host: "Servidor SMTP",
  smtp_port: "Puerto",
  smtp_secure: "Conexion SSL directa",
  smtp_user: "Usuario / Email",
  smtp_password: "Contrasena o App password",
  smtp_from: "Remitente (From)",
  email_resend_enabled: "Resend habilitado",
  email_resend_api_key: "API key",
  email_resend_from: "Remitente (From)",
};

/**
 * Placeholders por key — ayudan al usuario a saber que formato pegar.
 */
const PLACEHOLDER: Record<string, string> = {
  smtp_host: "smtp.gmail.com",
  smtp_port: "587",
  smtp_user: "tu@gmail.com",
  smtp_password: "app password 16 caracteres",
  smtp_from: "tu@gmail.com",
  email_resend_api_key: "re_xxxxxxxxxxxxxxxx",
  email_resend_from: "invitaciones@tu-dominio.com",
};

const KEY_GROUPS: KeyGroup[] = [
  {
    titulo: "Email SMTP",
    icon: Server,
    descripcion:
      "Envio nativo (Gmail, Zoho, Outlook o relay corporativo). Recomendado si ya tienes una casilla funcional. Tiene prioridad sobre Resend.",
    enabledKey: "smtp_enabled",
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
      titulo: "Guia rapida",
      items: [
        "Gmail: host smtp.gmail.com, puerto 587, SSL directo apagado. Generar app password en https://myaccount.google.com/apppasswords (NO usar la contrasena de la cuenta).",
        "Zoho: host smtppro.zoho.com, puerto 587. Activar SMTP en Settings > Mail Accounts > IMAP/POP.",
        "Outlook 365: host smtp.office365.com, puerto 587.",
        "Remitente debe coincidir con el usuario en Gmail; en Zoho puede ser un alias verificado.",
        "Con todo cargado, activar el toggle 'Envio SMTP habilitado' y probar con el boton de test.",
      ],
    },
  },
  {
    titulo: "Email Resend (alternativa)",
    icon: Mail,
    descripcion:
      "Envio via API HTTP de Resend. Util si preferis no mantener credenciales SMTP. Se ignora si SMTP esta activo.",
    enabledKey: "email_resend_enabled",
    keys: ["email_resend_enabled", "email_resend_api_key", "email_resend_from"],
    ayuda: {
      titulo: "Guia rapida",
      items: [
        "Crea una cuenta en https://resend.com (100 emails/dia gratis).",
        "Verifica tu dominio en Resend (Domains) para poder enviar desde invitaciones@tu-dominio.com.",
        "Crea una API key en Resend (API Keys) y pegala aca.",
        "Activa el toggle y prueba con el boton de test.",
      ],
    },
  },
];

function inferFieldType(key: string, isSecret: boolean): FieldType {
  if (key.endsWith("_enabled") || key.endsWith("_secure")) return "toggle";
  if (isSecret || key.endsWith("_password") || key.endsWith("_api_key")) return "password";
  if (key.endsWith("_port")) return "number";
  if (key.endsWith("_user") || key.endsWith("_from")) return "email";
  return "text";
}

async function updateSetting(key: string, value: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/v1/admin/system-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const j = await r.json();
    if (j.error) return { ok: false, error: j.error.message ?? "Error" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

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
          Variables de la plataforma. Los secrets se guardan encriptados con AES-256-GCM y nunca se exponen al frontend.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded flex items-start gap-2 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : (
        <>
          {KEY_GROUPS.map((group) => (
            <GroupCard
              key={group.titulo}
              group={group}
              settingsByKey={byKey}
              onSaved={cargar}
            />
          ))}
        </>
      )}
    </div>
  );
}

function GroupCard({
  group,
  settingsByKey,
  onSaved,
}: {
  group: KeyGroup;
  settingsByKey: (key: string) => SystemSetting | undefined;
  onSaved: () => void;
}) {
  const Icon = group.icon;
  const enabledSetting = group.enabledKey ? settingsByKey(group.enabledKey) : undefined;
  const isEnabled = enabledSetting?.value === "true";
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  // Detectar warning: hay creds cargados pero enabled=false
  const otrosCamposLlenos = useMemo(() => {
    const camposDeConfig = group.keys.filter((k) => k !== group.enabledKey);
    const llenos = camposDeConfig.filter((k) => {
      const s = settingsByKey(k);
      return Boolean(s?.value && s.value.trim().length > 0);
    });
    return llenos.length;
  }, [group, settingsByKey]);
  const mostrarWarning =
    Boolean(group.enabledKey) && !isEnabled && otrosCamposLlenos >= 3;

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <header className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-slate-700" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{group.titulo}</h3>
            {group.enabledKey && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide",
                  isEnabled
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                    : "bg-slate-100 text-slate-600 border border-slate-200",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isEnabled ? "bg-emerald-500" : "bg-slate-400",
                  )}
                />
                {isEnabled ? "Activo" : "Inactivo"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{group.descripcion}</p>
        </div>
        {group.testable && isEnabled && <TestEmailButton />}
      </header>

      <div className="p-5 space-y-4">
        {mostrarWarning && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-amber-900">
              <p className="font-semibold">Configuracion cargada pero no activada</p>
              <p className="mt-0.5">
                Ya cargaste las credenciales pero el envio esta apagado. Activa el toggle
                <span className="font-mono bg-white/50 px-1 rounded mx-1">
                  {FRIENDLY_LABEL[group.enabledKey!] ?? group.enabledKey}
                </span>
                para empezar a enviar emails.
              </p>
            </div>
          </div>
        )}

        {group.keys.map((key) => {
          const s = settingsByKey(key);
          if (!s) return null;
          return (
            <SettingRow
              key={key}
              setting={s}
              onSaved={onSaved}
              isEnabledKey={key === group.enabledKey}
            />
          );
        })}

        {group.ayuda && (
          <div className="mt-4 border border-sky-200 bg-sky-50/50 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setAyudaAbierta((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100/50 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                {group.ayuda.titulo}
              </span>
              {ayudaAbierta ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            {ayudaAbierta && (
              <ol className="list-decimal list-inside space-y-1 px-4 py-3 text-xs text-sky-900 border-t border-sky-200">
                {group.ayuda.items.map((it, i) => (
                  <li key={i} className="leading-relaxed">{it}</li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TestEmailButton() {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);

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
            ? { ok: true, mensaje: `Enviado via ${provider}. Revisa la bandeja de ${to}.` }
            : { ok: false, mensaje: `Fallo (${provider}): ${j.data?.reason ?? "sin detalle"}` },
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
        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md shadow-sm"
      >
        <Send className="w-3.5 h-3.5" />
        Probar envio
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-slate-900 mb-1">Enviar email de prueba</p>
            <p className="text-[11px] text-slate-600">
              Verifica las credenciales enviando un email a la casilla que elijas antes de mandar invitaciones reales.
            </p>
          </div>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="tu@correo.com"
            className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !to.trim()}
              className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
            >
              {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Enviar prueba
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setResultado(null);
                setTo("");
              }}
              className="px-2 h-8 text-xs text-slate-600 hover:text-slate-900"
            >
              Cerrar
            </button>
          </div>
          {resultado && (
            <div
              className={cn(
                "px-2.5 py-2 rounded text-xs border flex items-start gap-1.5",
                resultado.ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800",
              )}
            >
              {resultado.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              )}
              <span className="flex-1">{resultado.mensaje}</span>
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
  isEnabledKey,
}: {
  setting: SystemSetting;
  onSaved: () => void;
  isEnabledKey: boolean;
}) {
  const type = inferFieldType(setting.key, setting.isSecret);

  if (type === "toggle") {
    return <ToggleRow setting={setting} onSaved={onSaved} highlight={isEnabledKey} />;
  }
  return <InputRow setting={setting} onSaved={onSaved} type={type} />;
}

function ToggleRow({
  setting,
  onSaved,
  highlight,
}: {
  setting: SystemSetting;
  onSaved: () => void;
  highlight: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isOn = setting.value === "true";
  const label = FRIENDLY_LABEL[setting.key] ?? setting.key;

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    const nuevoValor = isOn ? "false" : "true";
    const res = await updateSetting(setting.key, nuevoValor);
    if (!res.ok) {
      setErr(res.error ?? "Error");
    } else {
      onSaved();
    }
    setSaving(false);
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-3 py-3 rounded-lg border transition-colors",
        highlight
          ? isOn
            ? "border-emerald-200 bg-emerald-50/50"
            : "border-slate-200 bg-slate-50/50"
          : "border-transparent hover:bg-slate-50",
      )}
    >
      <div className="flex-1 min-w-0">
        <label className="block text-sm font-semibold text-slate-800">{label}</label>
        {setting.descripcion && (
          <p className="text-xs text-slate-500 mt-0.5">{setting.descripcion}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {err && (
          <span className="text-xs text-rose-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {err}
          </span>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          onClick={toggle}
          disabled={saving}
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50",
            isOn ? "bg-emerald-600" : "bg-slate-300",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
              isOn ? "translate-x-6" : "translate-x-1",
            )}
          />
          {saving && (
            <Loader2 className="absolute inset-0 m-auto w-3 h-3 animate-spin text-white" />
          )}
        </button>
      </div>
    </div>
  );
}

function InputRow({
  setting,
  onSaved,
  type,
}: {
  setting: SystemSetting;
  onSaved: () => void;
  type: FieldType;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label = FRIENDLY_LABEL[setting.key] ?? setting.key.replace(/_/g, " ");
  const placeholder = PLACEHOLDER[setting.key] ?? "Pega el valor aca";
  const isPassword = type === "password";
  const isNumber = type === "number";
  const isEmail = type === "email";

  const startEdit = () => {
    setValue("");
    setErr(null);
    setEditing(true);
  };

  const guardar = async () => {
    setSaving(true);
    setErr(null);
    setOk(false);
    const res = await updateSetting(setting.key, value.trim() || null);
    if (!res.ok) {
      setErr(res.error ?? "Error");
    } else {
      setOk(true);
      setValue("");
      setEditing(false);
      onSaved();
      setTimeout(() => setOk(false), 2000);
    }
    setSaving(false);
  };

  const displayValue = (() => {
    if (!setting.value) return "(sin configurar)";
    if (isPassword) {
      // Mostrar solo primeros/ultimos 4 chars: nglc••••••••zfeo
      const v = setting.value;
      if (v.length <= 8) return "•".repeat(v.length);
      return `${v.slice(0, 4)}${"•".repeat(Math.min(v.length - 8, 12))}${v.slice(-4)}`;
    }
    return setting.value;
  })();

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-x-4 gap-y-1 items-start py-2 border-b border-slate-100 last:border-0">
      <div className="pt-2">
        <label className="block text-sm font-semibold text-slate-800">{label}</label>
        {setting.descripcion && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{setting.descripcion}</p>
        )}
      </div>
      <div>
        {!editing ? (
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex-1 px-3 h-9 inline-flex items-center text-sm font-mono rounded-md border",
                setting.value
                  ? "bg-slate-50 border-slate-200 text-slate-700"
                  : "bg-amber-50 border-amber-200 text-amber-700 italic font-sans",
              )}
            >
              {displayValue}
            </div>
            <button
              type="button"
              onClick={startEdit}
              className="px-3 h-9 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md transition-colors"
            >
              {setting.value ? "Cambiar" : "Configurar"}
            </button>
            {ok && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                Guardado
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {isPassword ? (
                <div className="relative flex-1">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    autoComplete="new-password"
                    className="w-full h-9 px-3 pr-9 text-sm font-mono rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    tabIndex={-1}
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              ) : (
                <input
                  type={isNumber ? "number" : isEmail ? "email" : "text"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={placeholder}
                  className="flex-1 h-9 px-3 text-sm font-mono rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void guardar();
                    if (e.key === "Escape") {
                      setEditing(false);
                      setValue("");
                      setErr(null);
                    }
                  }}
                />
              )}
              <button
                type="button"
                onClick={guardar}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 h-9 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-md shadow-sm transition-colors"
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
                className="px-2.5 h-9 text-xs text-slate-600 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>
            {isPassword && (
              <p className="text-[10px] text-slate-400 pl-1">
                Enter para guardar · Esc para cancelar · El valor se cifra con AES-256-GCM
              </p>
            )}
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
