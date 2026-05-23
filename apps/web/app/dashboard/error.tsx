"use client";

// Error boundary del segmento /dashboard. Sin esto, una excepcion en
// cualquier server-fetch o client component muestra pantalla en blanco.
// Next.js llama este componente con (error, reset) y mantiene navegacion.

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log al server. En produccion conectar a Sentry / Datadog aqui.
    console.error("dashboard_error_boundary", {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white border border-rose-200 rounded-lg shadow-sm p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-6 h-6 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Algo salio mal
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              No pudimos cargar esta seccion. Pode reintentar o volver al inicio.
            </p>
          </div>
        </div>

        {error.digest && (
          <p className="text-xs text-slate-500 mb-4 font-mono">
            ID de error: {error.digest}
          </p>
        )}

        {process.env.NODE_ENV !== "production" && (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 mb-4 overflow-x-auto text-rose-700">
            {error.message}
          </pre>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex-1 h-9 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reintentar
          </button>
          <a
            href="/dashboard"
            className="flex-1 h-9 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-medium rounded transition-colors inline-flex items-center justify-center"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}
