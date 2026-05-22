"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Server,
  Settings,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type AiProviderId = "claude" | "openai" | "ollama" | "gemini";

type AiProvider = {
  provider: AiProviderId;
  apiKeyConfigurado: boolean;
  apiKeyMasked: string;
  baseUrl: string | null;
  modelDefault: string | null;
  enabled: boolean;
  notas: string | null;
  updatedAt: string;
};

const PROVIDER_META: Record<
  AiProviderId,
  { label: string; icon: typeof Sparkles; descripcion: string; color: string; modelHint: string }
> = {
  claude: {
    label: "Anthropic Claude",
    icon: Sparkles,
    color: "violet",
    descripcion: "Modelo Claude (Opus/Sonnet/Haiku). Usado por Genie NL2SQL.",
    modelHint: "ej: claude-opus-4-7, claude-sonnet-4-6",
  },
  openai: {
    label: "OpenAI GPT",
    icon: Zap,
    color: "emerald",
    descripcion: "GPT-4o, GPT-4.1, o-series. Fallback para Genie y agentes futuros.",
    modelHint: "ej: gpt-4o, gpt-4.1, o1-preview",
  },
  ollama: {
    label: "Ollama (self-hosted)",
    icon: Server,
    color: "amber",
    descripcion: "Modelo local en tu servidor (ej Hetzner). Sin costo por token.",
    modelHint: "ej: llama3.1:8b, qwen2.5-coder, mistral",
  },
  gemini: {
    label: "Google Gemini",
    icon: Cpu,
    color: "sky",
    descripcion: "Gemini 2.0 / 2.5. Alternativa rapida y barata.",
    modelHint: "ej: gemini-2.0-flash, gemini-1.5-pro",
  },
};

export function AiProvidersSection() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/settings/ai-providers");
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        setProviders(json.data.rows as AiProvider[]);
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Proveedores de IA</h2>
        <p className="text-sm text-slate-600 mt-1">
          API keys de proveedores AI. Las keys se guardan encriptadas con AES-256-GCM
          en la base de datos — nunca aparecen en plaintext.
        </p>
        <p className="text-xs text-slate-500 mt-1">
          <strong>Genie</strong> usa el primer proveedor habilitado con key valida.
          Prioridad: Claude → Ollama → OpenAI → Gemini.
        </p>
      </div>

      <section>
        {error && (
          <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando...
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <ProviderCard key={p.provider} provider={p} onSaved={cargar} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProviderCard({
  provider,
  onSaved,
}: {
  provider: AiProvider;
  onSaved: () => void;
}) {
  const meta = PROVIDER_META[provider.provider];
  const Icon = meta.icon;
  const [editando, setEditando] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [modelDefault, setModelDefault] = useState(provider.modelDefault ?? "");
  const [enabled, setEnabled] = useState(provider.enabled);
  const [notas, setNotas] = useState(provider.notas ?? "");
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const guardar = async () => {
    setGuardando(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      const body: Record<string, unknown> = {
        baseUrl: baseUrl.trim() || null,
        modelDefault: modelDefault.trim() || null,
        enabled,
        notas: notas.trim() || null,
      };
      // Solo enviar apiKey si el campo se modifico (no vacio)
      if (apiKey.trim().length > 0) {
        body.apiKey = apiKey.trim();
      }
      const r = await fetch(`/api/v1/settings/ai-providers/${provider.provider}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (json.error) {
        setErrorMsg(json.error.message ?? "Error guardando");
      } else {
        setOkMsg("Guardado correctamente");
        setApiKey("");
        setEditando(false);
        onSaved();
        setTimeout(() => setOkMsg(null), 3000);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const limpiarKey = async () => {
    if (!confirm(`Borrar la API key de ${meta.label}? El servicio dejara de funcionar hasta que la reconfigures.`))
      return;
    setGuardando(true);
    setErrorMsg(null);
    try {
      await fetch(`/api/v1/settings/ai-providers/${provider.provider}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: null }),
      });
      onSaved();
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const color = meta.color;

  return (
    <article
      className={cn(
        "bg-white border rounded-xl overflow-hidden shadow-sm",
        provider.enabled ? "border-slate-200" : "border-slate-200 opacity-75",
      )}
    >
      <header className="px-4 py-3 flex items-center gap-3 border-b border-slate-100">
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            color === "violet" && "bg-violet-100 text-violet-700",
            color === "emerald" && "bg-emerald-100 text-emerald-700",
            color === "amber" && "bg-amber-100 text-amber-700",
            color === "sky" && "bg-sky-100 text-sky-700",
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            {meta.label}
            {provider.apiKeyConfigurado ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium uppercase tracking-wider">
                <CheckCircle2 className="w-3 h-3" />
                Configurado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-medium uppercase tracking-wider">
                Sin key
              </span>
            )}
            {!provider.enabled && (
              <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-medium uppercase tracking-wider">
                Deshabilitado
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{meta.descripcion}</p>
        </div>
        {!editando && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="text-xs font-medium px-3 h-8 bg-white border border-slate-300 hover:bg-slate-50 rounded"
          >
            Editar
          </button>
        )}
      </header>

      {!editando ? (
        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <Stat label="API key">
            <span className="font-mono text-slate-700">
              {provider.apiKeyMasked || "—"}
            </span>
          </Stat>
          <Stat label="Modelo default">
            <span className="font-mono text-slate-700">
              {provider.modelDefault ?? "—"}
            </span>
          </Stat>
          <Stat label="Base URL">
            <span className="font-mono text-slate-700 truncate block">
              {provider.baseUrl ?? "(default)"}
            </span>
          </Stat>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-3">
          {errorMsg && (
            <div className="p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
              {errorMsg}
            </div>
          )}
          {okMsg && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700 flex items-center gap-1">
              <Check className="w-3 h-3" />
              {okMsg}
            </div>
          )}

          <Field label="API key" hint={provider.apiKeyConfigurado ? "Dejar vacio para mantener la actual" : undefined}>
            <div className="flex gap-1">
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider.apiKeyConfigurado ? "•••••••• (actual)" : "Pegar la API key aqui"}
                  className="w-full h-9 px-3 pr-9 text-sm font-mono rounded border border-slate-300 focus:border-brand-500 outline-none"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label={showKey ? "Ocultar" : "Mostrar"}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {provider.apiKeyConfigurado && (
                <button
                  type="button"
                  onClick={limpiarKey}
                  disabled={guardando}
                  className="px-3 h-9 text-xs text-rose-700 border border-rose-200 hover:bg-rose-50 rounded"
                >
                  Borrar
                </button>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Modelo default" hint={meta.modelHint}>
              <input
                value={modelDefault}
                onChange={(e) => setModelDefault(e.target.value)}
                placeholder={meta.modelHint}
                className="w-full h-9 px-3 text-sm font-mono rounded border border-slate-300"
              />
            </Field>
            <Field
              label="Base URL"
              hint={
                provider.provider === "ollama"
                  ? "ej http://tu-server-hetzner:11434"
                  : "Vacio = endpoint oficial"
              }
            >
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  provider.provider === "ollama"
                    ? "http://tu-server:11434"
                    : "(default oficial)"
                }
                className="w-full h-9 px-3 text-sm font-mono rounded border border-slate-300"
              />
            </Field>
          </div>

          <Field label="Notas">
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Cuenta usada, plan, etc"
              className="w-full h-9 px-3 text-sm rounded border border-slate-300"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded text-brand-600 focus:ring-brand-500"
            />
            Habilitar este proveedor
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setEditando(false);
                setApiKey("");
                setBaseUrl(provider.baseUrl ?? "");
                setModelDefault(provider.modelDefault ?? "");
                setEnabled(provider.enabled);
                setNotas(provider.notas ?? "");
                setErrorMsg(null);
              }}
              disabled={guardando}
              className="px-4 h-9 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded inline-flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1"
            >
              {guardando ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Guardar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
