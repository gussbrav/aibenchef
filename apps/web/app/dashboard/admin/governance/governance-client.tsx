"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Database,
  Loader2,
  RefreshCw,
  ScrollText,
  Tags,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type Tab = "audit" | "glossary" | "tags";

type AuditRow = {
  id: string;
  occurredAt: string;
  category: string;
  action: string;
  severity: string;
  actorEmail: string | null;
  tenantName: string | null;
  resource: string | null;
  metadata: Record<string, unknown>;
};

type GlossaryRow = {
  id: string;
  schemaName: string;
  tableName: string;
  columnName: string | null;
  displayName: string;
  description: string;
  category: string;
  formula: string | null;
};

type TagRow = {
  id: string;
  schemaName: string;
  tableName: string;
  columnName: string;
  tag: string;
  note: string | null;
  setBy: string | null;
  setAt: string;
};

export function GovernanceClient() {
  const [tab, setTab] = useState<Tab>("audit");

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 border-b border-slate-200">
        <TabButton current={tab} value="audit" onClick={setTab} icon={ScrollText}>
          Audit Log
        </TabButton>
        <TabButton current={tab} value="glossary" onClick={setTab} icon={BookOpen}>
          Business Glossary
        </TabButton>
        <TabButton current={tab} value="tags" onClick={setTab} icon={Tags}>
          Column Tags
        </TabButton>
      </nav>

      {tab === "audit" && <AuditTab />}
      {tab === "glossary" && <GlossaryTab />}
      {tab === "tags" && <TagsTab />}
    </div>
  );
}

function TabButton({
  current,
  value,
  onClick,
  icon: Icon,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (v: Tab) => void;
  icon: typeof ScrollText;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5",
        active
          ? "border-violet-600 text-violet-700"
          : "border-transparent text-slate-600 hover:text-slate-900",
      )}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  );
}

// ----------------------------------------------------------------- AUDIT
function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = categoryFilter
        ? `/api/v1/governance/audit?categories=${encodeURIComponent(categoryFilter)}`
        : "/api/v1/governance/audit?limit=100";
      const r = await fetch(url);
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        setRows(json.data.rows ?? []);
        setTotal(json.data.total ?? 0);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-600 font-medium">Filtrar categoria:</label>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-sm border border-slate-300 rounded px-2 py-1"
        >
          <option value="">Todas</option>
          <option value="auth">auth</option>
          <option value="billing">billing</option>
          <option value="data_access">data_access</option>
          <option value="genie">genie</option>
          <option value="ai_providers">ai_providers</option>
          <option value="governance">governance</option>
          <option value="schema">schema</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          onClick={cargar}
          className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
        <span className="text-xs text-slate-500 ml-auto">
          {total.toLocaleString("es-PE")} eventos totales
        </span>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState message="Sin eventos. Cuando algun endpoint llame recordAuditEvent() aparecen aca." />
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Cuando</th>
                <th className="text-left px-3 py-2">Categoria</th>
                <th className="text-left px-3 py-2">Accion</th>
                <th className="text-left px-3 py-2">Severidad</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Recurso</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-mono text-slate-600 whitespace-nowrap">
                    {new Date(e.occurredAt).toLocaleString("es-PE")}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded font-mono">
                      {e.category}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-slate-700">{e.action}</td>
                  <td className="px-3 py-1.5">
                    <SeverityBadge severity={e.severity} />
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{e.actorEmail ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{e.resource ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    debug: "bg-slate-100 text-slate-600",
    info: "bg-sky-100 text-sky-700",
    warn: "bg-amber-100 text-amber-700",
    error: "bg-rose-100 text-rose-700",
    critical: "bg-rose-200 text-rose-900 font-bold",
  };
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono",
        colors[severity] ?? colors.info,
      )}
    >
      {severity}
    </span>
  );
}

// --------------------------------------------------------------- GLOSSARY
function GlossaryTab() {
  const [rows, setRows] = useState<GlossaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = search
        ? `/api/v1/governance/glossary?q=${encodeURIComponent(search)}`
        : "/api/v1/governance/glossary?limit=200";
      const r = await fetch(url);
      const json = await r.json();
      if (json.error) setError(json.error.message ?? "Error");
      else {
        setRows(json.data.rows ?? []);
        setTotal(json.data.total ?? 0);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const aplicarSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const r = await fetch("/api/v1/governance/glossary/seed", { method: "POST" });
      const json = await r.json();
      if (json.error) setSeedMsg("Error: " + json.error.message);
      else setSeedMsg(`Seed aplicado: ${json.data.upserted} entradas.`);
      cargar();
    } catch (e) {
      setSeedMsg("Error: " + String(e));
    } finally {
      setSeeding(false);
      setTimeout(() => setSeedMsg(null), 5000);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Buscar (full-text en castellano)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm border border-slate-300 rounded px-3 py-1.5"
        />
        <button
          type="button"
          onClick={aplicarSeed}
          disabled={seeding}
          className="text-xs px-3 py-1.5 bg-violet-100 hover:bg-violet-200 text-violet-900 rounded font-semibold disabled:opacity-50"
        >
          {seeding ? "Aplicando..." : "Aplicar seed canonico"}
        </button>
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {total.toLocaleString("es-PE")} entradas
        </span>
      </div>

      {seedMsg && (
        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">
          {seedMsg}
        </div>
      )}

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState message="Sin entradas. Aplica el seed canonico para poblar el glossary base." />
      ) : (
        <div className="space-y-2">
          {rows.map((g) => (
            <div
              key={g.id}
              className="border border-slate-200 rounded p-3 hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-mono text-slate-500">
                    {g.schemaName}.{g.tableName}
                    {g.columnName && <span className="text-violet-700">.{g.columnName}</span>}
                  </p>
                  <h4 className="font-semibold text-slate-900 mt-0.5">{g.displayName}</h4>
                  <p className="text-sm text-slate-700 mt-1">{g.description}</p>
                  {g.formula && (
                    <p className="text-xs text-slate-600 mt-1 font-mono">
                      <span className="text-slate-400">Formula:</span> {g.formula}
                    </p>
                  )}
                </div>
                <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-mono uppercase tracking-wider">
                  {g.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- TAGS
function TagsTab() {
  const [rows, setRows] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/governance/tags?limit=200");
        const json = await r.json();
        if (json.error) setError(json.error.message);
        else setRows(json.data.rows ?? []);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} />;
  if (rows.length === 0) {
    return (
      <EmptyState message="Sin tags. Agrega tags desde /dashboard/catalog para marcar columnas como PII, deprecated, etc." />
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 px-3 py-2 border border-slate-200 rounded text-xs hover:bg-slate-50"
        >
          <span className="font-mono text-slate-600 flex-1">
            {t.schemaName}.{t.tableName}.<span className="text-violet-700">{t.columnName}</span>
          </span>
          <TagBadge tag={t.tag} />
          {t.note && <span className="text-slate-500 italic">{t.note}</span>}
          <span className="text-slate-400">
            por {t.setBy ?? "?"} el {new Date(t.setAt).toLocaleDateString("es-PE")}
          </span>
        </div>
      ))}
    </div>
  );
}

function TagBadge({ tag }: { tag: string }) {
  const colors: Record<string, string> = {
    pii: "bg-rose-100 text-rose-700",
    sensitive: "bg-amber-100 text-amber-700",
    calculated: "bg-violet-100 text-violet-700",
    deprecated: "bg-slate-200 text-slate-700",
    experimental: "bg-amber-100 text-amber-700",
    public: "bg-emerald-100 text-emerald-700",
    regulatory: "bg-sky-100 text-sky-700",
    financial: "bg-emerald-100 text-emerald-700",
  };
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono",
        colors[tag] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {tag}
    </span>
  );
}

// --------------------------------------------------------------- HELPERS
function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" />
      Cargando...
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-10 text-sm text-slate-500">
      <Database className="w-8 h-8 mx-auto mb-2 text-slate-300" />
      {message}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      {message}
    </div>
  );
}
