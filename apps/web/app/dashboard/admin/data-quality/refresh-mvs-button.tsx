"use client";

/**
 * RefreshMvsButton — trigger manual del refresh de TODAS las MVs
 * (equivalente al `docker exec aibenchef-data aibenchef pipeline refresh-marts`).
 *
 * Encola un sync_job especial que el worker_daemon detecta y procesa
 * ejecutando `refresh-marts --concurrent` internamente. Retorna en <1 seg.
 * El refresh real tarda 30-60 min en background.
 */

import { useState } from "react";
import { Loader2, RefreshCw, Zap } from "lucide-react";

type ActionResult = {
  ok: boolean;
  jobId: number | null;
  alreadyRunning: boolean;
  mensaje: string;
};

export function RefreshMvsButton({ nStale }: { nStale: number }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = async () => {
    if (
      !confirm(
        "¿Refrescar TODAS las MVs?\n\n" +
        "• El worker (aibenchef-data) recibe el trigger en <1 seg (LISTEN/NOTIFY).\n" +
        "• El refresh real tarda 30-60 min (mv_eeff_balance_ancho es el más pesado).\n" +
        "• Corre en background, no bloquea los dashboards (--concurrent).\n" +
        "• Refresca este panel en unos minutos para ver el progreso.",
      )
    ) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/admin/refresh-mvs?all=true", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const payload = (json?.data ?? json) as ActionResult;
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {nStale > 0 && (
        <span className="text-xs text-red-700 font-medium">
          {nStale} MVs fuera de SLA — refrescá para poner al día
        </span>
      )}
      <button
        type="button"
        onClick={trigger}
        disabled={loading}
        className="inline-flex items-center gap-1.5 h-9 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded shadow-sm"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Encolando...
          </>
        ) : (
          <>
            <Zap className="w-4 h-4" />
            Refrescar MVs ahora
          </>
        )}
      </button>

      {result && (
        <div
          className={`text-xs px-2 py-1 rounded border ${
            result.alreadyRunning
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          {result.mensaje}
          {result.jobId && (
            <>
              {" · "}
              <a href="/dashboard/admin/pipeline" className="underline">
                Ver job #{result.jobId}
              </a>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs px-2 py-1 rounded border bg-red-50 border-red-200 text-red-800">
          {error}
        </div>
      )}

      {!result && !error && !loading && (
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
          <RefreshCw className="w-2.5 h-2.5" />
          Latencia trigger: &lt;1 seg · Refresh real: 30-60 min en background
        </span>
      )}
    </div>
  );
}
