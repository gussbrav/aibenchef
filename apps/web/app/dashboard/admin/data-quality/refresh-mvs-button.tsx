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
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
      {/* Explicacion clara de que es AUTOMATICO */}
      <div className="flex items-start gap-2 text-[11px] text-slate-600">
        <span className="text-base leading-none">🤖</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 mb-0.5">
            El refresh es <span className="text-emerald-700">automático</span> — no
            necesitas hacer clic normalmente
          </p>
          <p className="leading-relaxed">
            El worker <code className="text-[10px] bg-white px-1 rounded">aibenchef-data</code> refresca
            las MVs sin intervención en 2 casos: (1) tras cada import exitoso de SBS
            (LISTEN/NOTIFY, &lt;1 seg), y (2) cada 30 min si detecta MVs con &gt;6h de
            atraso (watchdog automático). El botón de abajo es solo para{" "}
            <strong>trigger inmediato</strong> si no quieres esperar hasta 30 min.
          </p>
        </div>
      </div>

      {/* Botón manual — presentado como excepción */}
      <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-slate-200">
        {nStale > 0 && (
          <span className="text-xs text-red-700 font-medium">
            ⚠️ {nStale} MVs fuera de SLA
          </span>
        )}
        <button
          type="button"
          onClick={trigger}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 border border-slate-300 text-[11px] font-medium rounded"
          title="Trigger inmediato — atajo al watchdog automático"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Encolando...
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 text-blue-600" />
              Forzar refresh inmediato (opcional)
            </>
          )}
        </button>

        {result && (
          <div
            className={`text-[11px] px-2 py-1 rounded border ${
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
          <div className="text-[11px] px-2 py-1 rounded border bg-red-50 border-red-200 text-red-800">
            {error}
          </div>
        )}

        {!result && !error && !loading && nStale > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <RefreshCw className="w-2.5 h-2.5" />
            Sin hacer nada: se auto-refresca en máx 30 min
          </span>
        )}
      </div>
    </div>
  );
}
