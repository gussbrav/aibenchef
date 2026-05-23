"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Wrench, XCircle } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { ErrorBox, parseApiError } from "@/components/error-box";

type Check = {
  name: string;
  status: "ok" | "error";
  detail?: string;
  durationMs: number;
  error?: string;
  errorCode?: string;
};

type HealthResponse = {
  overall: "ok" | "error";
  errorCount: number;
  gitSha: string | null;
  nodeEnv: string;
  timestamp: string;
  checks: Check[];
};

export function DebugSection() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const correr = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/admin/debug/healthcheck");
      const json = await r.json();
      if (json.error) setError(parseApiError(json));
      else setData(json.data as HealthResponse);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-slate-600" />
            Diagnostico del sistema
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Ejecuta queries reales contra cada subsistema para identificar fallas. Util
            cuando un endpoint devuelve 500 generico — aca ves cual modulo esta roto.
          </p>
        </div>
        <button
          type="button"
          onClick={correr}
          disabled={loading}
          className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded inline-flex items-center gap-1.5"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Correr diagnostico
        </button>
      </div>

      <ErrorBox error={error as never} />

      {data && (
        <>
          <section
            className={cn(
              "p-3 rounded border flex items-center gap-3",
              data.overall === "ok"
                ? "bg-emerald-50 border-emerald-200"
                : "bg-rose-50 border-rose-200",
            )}
          >
            {data.overall === "ok" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-700 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-700 flex-shrink-0" />
            )}
            <div className="flex-1 text-sm">
              <p className="font-semibold">
                {data.overall === "ok"
                  ? "Todos los checks pasaron"
                  : `${data.errorCount} checks con error`}
              </p>
              <p className="text-xs text-slate-600">
                git_sha: <span className="font-mono">{data.gitSha ?? "—"}</span> ·
                env: <span className="font-mono">{data.nodeEnv}</span> ·
                {" "}{new Date(data.timestamp).toLocaleString("es-PE")}
              </p>
            </div>
          </section>

          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Check</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Detalle</th>
                  <th className="text-right px-3 py-2 font-semibold">Tiempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.checks.map((c) => (
                  <tr
                    key={c.name}
                    className={cn(c.status === "error" && "bg-rose-50/50")}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">
                      {c.name}
                    </td>
                    <td className="px-3 py-2">
                      {c.status === "ok" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium uppercase tracking-wider">
                          <CheckCircle2 className="w-3 h-3" />
                          ok
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-rose-100 text-rose-700 rounded font-medium uppercase tracking-wider">
                          <XCircle className="w-3 h-3" />
                          error
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700 font-mono">
                      {c.status === "error" ? (
                        <>
                          <span className="text-rose-700">{c.error}</span>
                          {c.errorCode && (
                            <span className="ml-1 text-[10px] px-1 py-0.5 bg-rose-100 text-rose-700 rounded">
                              {c.errorCode}
                            </span>
                          )}
                        </>
                      ) : (
                        c.detail ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500 font-mono">
                      {c.durationMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
