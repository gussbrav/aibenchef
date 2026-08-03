"use client";

/**
 * LlmProvidersClient — tabla + modal para gestionar proveedores LLM.
 *
 * Interaccion con el server-side via /api/v1/admin/llm-providers.
 * La api key SOLO viaja del browser al server via POST HTTPS al crear
 * o rotar. NUNCA se recibe de vuelta (solo el hint de ultimos 4 chars).
 */

import { useState, useTransition } from "react";
import {
  Check, X, Plus, Star, TestTube, Trash2, Edit3, AlertCircle, Loader2,
} from "lucide-react";
import type { LlmProviderPublic, ProviderType } from "@/lib/domains/llm-vault";

type FormState = {
  id?: string;
  providerType: ProviderType;
  displayName: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  clienteSlug: string;
  isDefault: boolean;
  maxTokensOutput: number;
  temperature: number;
};

const EMPTY_FORM: FormState = {
  providerType: "anthropic",
  displayName: "",
  model: "claude-haiku-4-5",
  apiKey: "",
  baseUrl: "",
  clienteSlug: "",
  isDefault: false,
  maxTokensOutput: 800,
  temperature: 0.3,
};

const MODEL_SUGGESTIONS: Record<ProviderType, string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  openai_compatible: ["llama-3.1-70b", "mixtral-8x7b"],
  ollama: ["llama-3.1-70b", "llama-3.1-8b", "qwen2.5:32b"],
  google: ["gemini-1.5-pro", "gemini-1.5-flash"],
};

export function LlmProvidersClient({
  initialProviders,
}: {
  initialProviders: LlmProviderPublic[];
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [showModal, setShowModal] = useState(false);
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [_, startTransition] = useTransition();

  const refresh = async () => {
    const res = await fetch("/api/v1/admin/llm-providers");
    const json = await res.json();
    if (json?.providers) setProviders(json.providers);
  };

  const openNew = () => {
    setFormState(EMPTY_FORM);
    setIsEditing(false);
    setShowModal(true);
  };

  const openEdit = (p: LlmProviderPublic) => {
    setFormState({
      id: p.id,
      providerType: p.providerType,
      displayName: p.displayName,
      model: p.model,
      apiKey: "", // vacio -> no rota la key
      baseUrl: p.baseUrl ?? "",
      clienteSlug: p.clienteSlug ?? "",
      isDefault: p.isDefault,
      maxTokensOutput: p.maxTokensOutput,
      temperature: p.temperature,
    });
    setIsEditing(true);
    setShowModal(true);
  };

  const handleDelete = async (p: LlmProviderPublic) => {
    if (!confirm(`Eliminar proveedor "${p.displayName}"? Esta accion no se puede deshacer.`)) {
      return;
    }
    startTransition(async () => {
      await fetch(`/api/v1/admin/llm-providers/${p.id}`, { method: "DELETE" });
      await refresh();
    });
  };

  const handleSetDefault = async (p: LlmProviderPublic) => {
    startTransition(async () => {
      await fetch(`/api/v1/admin/llm-providers/${p.id}/set-default`, { method: "POST" });
      await refresh();
    });
  };

  const handleTest = async (p: LlmProviderPublic) => {
    startTransition(async () => {
      const res = await fetch(`/api/v1/admin/llm-providers/${p.id}/test`, { method: "POST" });
      const json = await res.json();
      if (json?.ok) {
        alert(`✓ ${p.displayName} respondio OK`);
      } else {
        alert(`✗ Test fallo: ${json?.error ?? "error desconocido"}`);
      }
      await refresh();
    });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-600">
          {providers.length} proveedor{providers.length === 1 ? "" : "es"} configurado{providers.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 h-9 px-4 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar proveedor
        </button>
      </div>

      {providers.length === 0 ? (
        <EmptyState onAdd={openNew} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <Th>Proveedor</Th>
                <Th>Modelo</Th>
                <Th>API Key</Th>
                <Th>Alcance</Th>
                <Th>Estado</Th>
                <Th>Último test</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providers.map((p) => (
                <tr key={p.id} className={p.isDefault ? "bg-amber-50/40" : ""}>
                  <Td>
                    <div className="flex items-center gap-2">
                      {p.isDefault && (
                        <span title="Proveedor por defecto de su alcance">
                          <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                        </span>
                      )}
                      <span className="font-semibold text-slate-900">{p.displayName}</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">
                      {p.providerType.replace("_", "-")}
                    </div>
                  </Td>
                  <Td className="font-mono text-xs">{p.model}</Td>
                  <Td>
                    {p.hasApiKey ? (
                      <span className="font-mono text-xs text-slate-700">
                        {p.apiKeyHint ?? "—"}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 italic">sin auth</span>
                    )}
                  </Td>
                  <Td>
                    {p.clienteSlug ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-medium">
                        {p.clienteSlug}
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">
                        global
                      </span>
                    )}
                  </Td>
                  <Td>
                    {p.isActive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                        <Check className="w-3.5 h-3.5" /> activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                        <X className="w-3.5 h-3.5" /> inactivo
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {p.lastTestAt ? (
                      <div>
                        <span
                          className={
                            p.lastTestOk
                              ? "text-emerald-700 font-medium"
                              : "text-red-700 font-medium"
                          }
                        >
                          {p.lastTestOk ? "OK" : "Falló"}
                        </span>
                        <div className="text-slate-500 text-[10px]">
                          {new Date(p.lastTestAt).toLocaleString("es-PE")}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">nunca</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <IconBtn onClick={() => handleTest(p)} title="Probar conexión">
                        <TestTube className="w-3.5 h-3.5" />
                      </IconBtn>
                      {!p.isDefault && (
                        <IconBtn onClick={() => handleSetDefault(p)} title="Setear como default">
                          <Star className="w-3.5 h-3.5" />
                        </IconBtn>
                      )}
                      <IconBtn onClick={() => openEdit(p)} title="Editar">
                        <Edit3 className="w-3.5 h-3.5" />
                      </IconBtn>
                      <IconBtn
                        onClick={() => handleDelete(p)}
                        title="Eliminar"
                        variant="danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconBtn>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ProviderModal
          state={formState}
          isEditing={isEditing}
          onClose={() => setShowModal(false)}
          onChange={setFormState}
          onSaved={() => {
            setShowModal(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function ProviderModal({
  state,
  isEditing,
  onClose,
  onChange,
  onSaved,
}: {
  state: FormState;
  isEditing: boolean;
  onClose: () => void;
  onChange: (s: FormState) => void;
  onSaved: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        isEditing
          ? `/api/v1/admin/llm-providers/${state.id}/test`
          : `/api/v1/admin/llm-providers/new/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerType: state.providerType,
            model: state.model,
            apiKey: state.apiKey || undefined,
            baseUrl: state.baseUrl || undefined,
          }),
        },
      );
      const json = await res.json();
      setTestResult(json.ok ? { ok: true } : { ok: false, error: json.error });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        providerType: state.providerType,
        displayName: state.displayName,
        model: state.model,
        apiKey: state.apiKey || undefined,
        baseUrl: state.baseUrl || null,
        clienteSlug: state.clienteSlug || null,
        isDefault: state.isDefault,
        maxTokensOutput: state.maxTokensOutput,
        temperature: state.temperature,
      };
      const res = await fetch(
        isEditing
          ? `/api/v1/admin/llm-providers/${state.id}`
          : `/api/v1/admin/llm-providers`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? json?.error ?? "Error desconocido");
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            {isEditing ? "Editar proveedor" : "Agregar proveedor LLM"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-3 overflow-y-auto text-sm">
          <Field label="Tipo de proveedor">
            <select
              value={state.providerType}
              onChange={(e) => {
                const t = e.target.value as ProviderType;
                onChange({ ...state, providerType: t, model: MODEL_SUGGESTIONS[t]![0] ?? "" });
              }}
              className="w-full h-9 px-2 border border-slate-300 rounded"
              disabled={isEditing}
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="openai_compatible">OpenAI-compatible (Groq, Together, ...)</option>
              <option value="ollama">Ollama (self-hosted)</option>
              <option value="google">Google (Gemini)</option>
            </select>
          </Field>

          <Field label="Nombre para display">
            <input
              type="text"
              value={state.displayName}
              onChange={(e) => onChange({ ...state, displayName: e.target.value })}
              placeholder="Ej: Claude Haiku (prod)"
              className="w-full h-9 px-2 border border-slate-300 rounded"
            />
          </Field>

          <Field label="Modelo">
            <input
              type="text"
              list="model-suggestions"
              value={state.model}
              onChange={(e) => onChange({ ...state, model: e.target.value })}
              placeholder="Ej: claude-haiku-4-5"
              className="w-full h-9 px-2 border border-slate-300 rounded font-mono text-xs"
            />
            <datalist id="model-suggestions">
              {(MODEL_SUGGESTIONS[state.providerType] ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>

          <Field
            label={isEditing ? "API Key (dejar vacío para no rotar)" : "API Key"}
            hint={
              state.providerType === "ollama"
                ? "Opcional para Ollama self-hosted sin auth"
                : "Se cifra AES-256 al guardar"
            }
          >
            <input
              type="password"
              value={state.apiKey}
              onChange={(e) => onChange({ ...state, apiKey: e.target.value })}
              placeholder={isEditing ? "•••• sin cambios" : "sk-..."}
              className="w-full h-9 px-2 border border-slate-300 rounded font-mono text-xs"
              autoComplete="off"
            />
          </Field>

          {(state.providerType === "ollama" ||
            state.providerType === "openai_compatible") && (
            <Field label="Base URL" hint="Endpoint del servidor OpenAI-compatible">
              <input
                type="url"
                value={state.baseUrl}
                onChange={(e) => onChange({ ...state, baseUrl: e.target.value })}
                placeholder="http://localhost:11434 o https://api.groq.com/openai/v1"
                className="w-full h-9 px-2 border border-slate-300 rounded font-mono text-xs"
              />
            </Field>
          )}

          <Field label="Cliente (opcional)" hint="Vacío = provider global (para todos los clientes)">
            <input
              type="text"
              value={state.clienteSlug}
              onChange={(e) => onChange({ ...state, clienteSlug: e.target.value })}
              placeholder="Ej: interbank (dejar vacío = global)"
              className="w-full h-9 px-2 border border-slate-300 rounded"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Max tokens output">
              <input
                type="number"
                min={50}
                max={4000}
                step={50}
                value={state.maxTokensOutput}
                onChange={(e) => onChange({ ...state, maxTokensOutput: Number(e.target.value) })}
                className="w-full h-9 px-2 border border-slate-300 rounded"
              />
            </Field>
            <Field label="Temperature (0-1)">
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={state.temperature}
                onChange={(e) => onChange({ ...state, temperature: Number(e.target.value) })}
                className="w-full h-9 px-2 border border-slate-300 rounded"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              checked={state.isDefault}
              onChange={(e) => onChange({ ...state, isDefault: e.target.checked })}
            />
            <span className="text-sm">Setear como proveedor por defecto</span>
          </label>

          {testResult && (
            <div
              className={`p-2 rounded text-xs ${
                testResult.ok
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {testResult.ok ? "✓ Conexión OK" : `✗ ${testResult.error}`}
            </div>
          )}

          {error && (
            <div className="p-2 rounded text-xs bg-red-50 text-red-800 border border-red-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between px-5 py-3 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || (!state.apiKey && state.providerType !== "ollama")}
            className="inline-flex items-center gap-1.5 h-9 px-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium rounded disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <TestTube className="w-3.5 h-3.5" />
            )}
            Probar conexión
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3 text-slate-600 hover:text-slate-900 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !state.displayName || !state.model}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEditing ? "Guardar cambios" : "Crear proveedor"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-slate-500 mb-4">
        Aún no hay proveedores LLM configurados. Agregá uno para habilitar los
        insights automáticos del benchmark.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 h-10 px-5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded"
      >
        <Plus className="w-4 h-4" />
        Agregar primer proveedor
      </button>
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
    <label className="block">
      <span className="text-xs font-medium text-slate-700 mb-1 block">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-500 mt-0.5 block">{hint}</span>}
    </label>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function IconBtn({
  onClick,
  title,
  children,
  variant,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  variant?: "danger";
}) {
  const base = "p-1.5 rounded transition-colors";
  const cls = variant === "danger"
    ? `${base} text-slate-400 hover:text-red-700 hover:bg-red-50`
    : `${base} text-slate-500 hover:text-slate-900 hover:bg-slate-100`;
  return (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {children}
    </button>
  );
}
