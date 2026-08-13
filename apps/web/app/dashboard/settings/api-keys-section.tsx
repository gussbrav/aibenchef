"use client";

/**
 * ApiKeysSection — CRUD de API keys en /dashboard/settings.
 *
 * Solo visible para users con apiAccess (academic/pro/business/admin).
 *
 * Flow de creacion:
 *   1. User clickea "Nueva API key" -> se abre form con name + note
 *   2. Submit -> POST /api/v1/settings/api-keys -> devuelve token en clear
 *   3. UI muestra el token en un panel destacado con boton "Copiar" +
 *      advertencia "guardalo bien, no lo veras de nuevo"
 *   4. Al cerrar el panel, el token en clear se descarta (no se guarda
 *      en state).
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { Button, Input } from "@/components/ui";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  note: string | null;
};

type Created = ApiKey & { plainToken: string };

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [justCreated, setJustCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/settings/api-keys");
      const j = await r.json();
      if (j.error) throw new Error(j.error.message ?? "Error cargando keys");
      setKeys(j.data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setError(null);
    try {
      const r = await fetch("/api/v1/settings/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), note: newNote.trim() || null }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message ?? "Error creando key");
      setJustCreated(j.data as Created);
      setCreating(false);
      setNewName("");
      setNewNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (
      !confirm(
        `¿Revocar la key "${name}"? Los scripts o servidores que la usen dejarán de funcionar inmediatamente. Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    try {
      const r = await fetch(`/api/v1/settings/api-keys/${id}`, { method: "DELETE" });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message ?? "Error revocando key");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const activas = keys.filter((k) => !k.revokedAt);
  const revocadas = keys.filter((k) => k.revokedAt);

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Key className="w-5 h-5 text-brand-600" />
            API keys
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Autentica tus requests a la API pública o al MCP server para Claude Desktop.
            <a
              href="/docs/api"
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline"
            >
              Ver documentación <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
        {!creating && !justCreated && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            Nueva API key
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Panel de key recien creada — muestra el token en clear una unica vez */}
      {justCreated && (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-emerald-700" strokeWidth={3} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-emerald-900">
                API key "{justCreated.name}" creada
              </p>
              <p className="text-xs text-emerald-800 mt-0.5">
                <strong>Guarda este token ahora.</strong> Por seguridad no
                podrás volver a verlo. Si lo pierdes, tendrás que revocarlo
                y crear uno nuevo.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-800 break-all">
            <span className="flex-1">{justCreated.plainToken}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(justCreated.plainToken)}
              className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700 flex-shrink-0"
              title="Copiar al portapapeles"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setJustCreated(null)}
              className="text-sm text-emerald-700 hover:text-emerald-900 font-medium"
            >
              Ya lo guardé, cerrar
            </button>
          </div>
        </div>
      )}

      {/* Form de creacion */}
      {creating && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nombre <span className="text-rose-600">*</span>
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej: Mi laptop, Servidor tesis, MCP local"
              maxLength={80}
              autoFocus
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Solo para identificar la key en esta lista. No aparece en los requests.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nota (opcional)
            </label>
            <Input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ej: solo lectura, uso en Claude Desktop..."
              maxLength={200}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewNote("");
              }}
            >
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={!newName.trim()}>
              Crear key
            </Button>
          </div>
        </div>
      )}

      {/* Lista de keys activas */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-2">
          Activas ({activas.length})
        </h3>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando…
          </div>
        ) : activas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Aún no creaste ninguna API key.
          </div>
        ) : (
          <ul className="space-y-2">
            {activas.map((k) => (
              <li
                key={k.id}
                className="rounded-lg border border-slate-200 bg-white p-3 flex items-center gap-3 flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900">{k.name}</p>
                  <p className="font-mono text-xs text-slate-500 mt-0.5">
                    {k.prefix}…{k.last4}
                  </p>
                  {k.note && (
                    <p className="text-xs text-slate-500 mt-0.5 italic">{k.note}</p>
                  )}
                </div>
                <div className="text-xs text-slate-500 text-right">
                  <div>Creada {formatDate(k.createdAt)}</div>
                  <div>
                    {k.lastUsedAt ? `Últ. uso ${formatDate(k.lastUsedAt)}` : "Sin usar"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(k.id, k.name)}
                  className="p-2 rounded hover:bg-rose-50 text-rose-600 hover:text-rose-800"
                  title="Revocar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Lista de keys revocadas (para auditoria) */}
      {revocadas.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
            Ver keys revocadas ({revocadas.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {revocadas.map((k) => (
              <li
                key={k.id}
                className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500 flex items-center gap-3"
              >
                <span className="line-through">{k.name}</span>
                <span className="font-mono">{k.prefix}…{k.last4}</span>
                <span className="ml-auto">Revocada {formatDate(k.revokedAt!)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-PE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
