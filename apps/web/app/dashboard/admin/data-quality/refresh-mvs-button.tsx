"use client";

/**
 * RefreshMvsButton — trigger manual del refresh de TODAS las MVs
 * (equivalente al `docker exec aibenchef-data aibenchef pipeline refresh-marts`).
 *
 * Encola un sync_job especial que el worker_daemon detecta y procesa
 * ejecutando `refresh-marts --concurrent` internamente. Retorna en <1 seg.
 * El refresh real tarda 30-60 min en background.
 */

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Zap, X, AlertTriangle } from "lucide-react";

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
  const [modalOpen, setModalOpen] = useState(false);

  // Cerrar modal con Escape
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const trigger = async () => {
    setModalOpen(false);
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
          onClick={() => setModalOpen(true)}
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

      {/* Modal elegante — reemplaza el confirm() nativo del navegador */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="refresh-mvs-modal-title"
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header con gradiente sutil */}
            <div className="relative bg-gradient-to-br from-blue-50 to-indigo-50 border-b border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="absolute top-3 right-3 p-1 rounded-md hover:bg-white/60 text-slate-500 hover:text-slate-700 transition"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <h3
                    id="refresh-mvs-modal-title"
                    className="text-base font-semibold text-slate-900 leading-tight"
                  >
                    ¿Refrescar TODAS las MVs?
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Trigger inmediato del refresh que el worker corre automáticamente.
                  </p>
                </div>
              </div>
            </div>

            {/* Body con detalles */}
            <div className="px-5 py-4 space-y-3">
              <ul className="space-y-2 text-[13px] text-slate-700">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  <span>
                    El worker <code className="text-[11px] bg-slate-100 px-1 rounded">aibenchef-data</code>{" "}
                    recibe el trigger en <strong>&lt;1 seg</strong> (LISTEN/NOTIFY).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  <span>
                    El refresh real tarda <strong>30-60 min</strong> (mv_eeff_balance_ancho es el más pesado).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span>
                    Corre en background con <strong>--concurrent</strong>, no bloquea los dashboards.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                  <span className="text-slate-600">
                    Refresca este panel en unos minutos para ver el progreso.
                  </span>
                </li>
              </ul>

              {nStale > 0 && (
                <div className="flex items-start gap-2 text-[12px] bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
                  <span>
                    Hay <strong>{nStale} MVs</strong> fuera de SLA en este momento.
                  </span>
                </div>
              )}
            </div>

            {/* Footer con acciones */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-9 px-4 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-md transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={trigger}
                className="h-9 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md inline-flex items-center gap-1.5 shadow-sm transition"
                autoFocus
              >
                <Zap className="w-4 h-4" />
                Refrescar ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
