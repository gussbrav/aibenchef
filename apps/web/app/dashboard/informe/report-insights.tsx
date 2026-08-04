"use client";

/**
 * ReportInsights — panel de bullets AI-generados para una seccion del informe.
 *
 * Comportamiento:
 *   1. On mount: GET /api/v1/informe/insights (cache-only, cero costo si miss)
 *   2. Si hay cache -> renderiza bullets
 *   3. Si no hay cache -> muestra boton "Generar analisis con IA"
 *   4. Al click -> POST /generate + streaming spinner
 *   5. Manejo de errores: rate limit / no provider / LLM error -> mensajes claros
 *   6. Icono AI + tono profesional
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import type { InsightSeccion } from "@/lib/domains/insights";

type Insight = {
  id: string;
  bullets: string[];
  isOverride: boolean;
  generatedAt: string;
};

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "generating" }
  | { kind: "ready"; insight: Insight; fromCache: boolean }
  | { kind: "error"; message: string; canRetry: boolean };

export function ReportInsights({
  periodo,
  seccion,
  clienteSlug,
  entidadPropia,
  peerGroup,
  contexto,
}: {
  periodo: number;
  seccion: InsightSeccion;
  clienteSlug: string;
  entidadPropia: string;
  peerGroup: string[];
  /** Data especifica de la seccion. Ver prompts/*.ts para el shape esperado. */
  contexto: Record<string, unknown>;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  // ESTABILIZAR REFERENCIAS: peerGroup y contexto son arrays/objetos
  // nuevos en cada render del padre. Sin estos keys, useCallback recrea
  // fetchCached en cada render, useEffect re-corre infinitamente y pisa
  // cualquier state (spinner de generate, bullets renderizados, etc).
  const peerGroupKey = peerGroup.join("|");
  const contextoKey = JSON.stringify(contexto);

  const fetchCached = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const params = new URLSearchParams({
        periodo: String(periodo),
        seccion,
        peerGroup: peerGroupKey.split("|").join(","),
        entidadPropia,
      });
      const res = await fetch(`/api/v1/informe/insights?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // El helper handleRoute() del proyecto envuelve toda respuesta
      // exitosa en { data: <payload>, requestId }. Soportamos ambos
      // shapes por si en el futuro se cambia el wrapper.
      const insight = (json?.data?.insight ?? json?.insight) as Insight | null;
      if (insight) {
        setState({ kind: "ready", insight, fromCache: true });
      } else {
        setState({ kind: "empty" });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Error desconocido",
        canRetry: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, seccion, peerGroupKey, entidadPropia]);

  const generate = useCallback(async () => {
    setState({ kind: "generating" });
    try {
      const res = await fetch("/api/v1/informe/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo,
          seccion,
          clienteSlug,
          entidadPropia,
          peerGroup: peerGroupKey.split("|"),
          contexto: JSON.parse(contextoKey),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.error ?? `HTTP ${res.status}`;
        setState({ kind: "error", message: String(msg), canRetry: res.status !== 429 });
        return;
      }
      // Post-generate: GET para traer el insight persistido en formato standard
      await fetchCached();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Error desconocido",
        canRetry: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, seccion, clienteSlug, entidadPropia, peerGroupKey, contextoKey, fetchCached]);

  useEffect(() => {
    void fetchCached();
  }, [fetchCached]);

  return (
    <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 print-avoid-break">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-700" />
          <h3 className="text-sm font-semibold text-slate-900">
            Analisis del experto
          </h3>
        </div>
        {state.kind === "ready" && (
          <button
            type="button"
            onClick={generate}
            title="Regenerar analisis"
            className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors no-print"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </header>

      {state.kind === "loading" && (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Buscando analisis...
        </div>
      )}

      {state.kind === "empty" && (
        <div className="text-center py-4">
          <p className="text-xs text-slate-500 mb-3">
            Genera un analisis ejecutivo automatico basado en los datos de esta seccion.
          </p>
          <button
            type="button"
            onClick={generate}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-brand-700 hover:bg-brand-800 text-white text-xs font-medium rounded transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generar analisis con IA
          </button>
        </div>
      )}

      {state.kind === "generating" && (
        <div className="flex items-center gap-2 text-xs text-slate-600 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-700" />
          Generando analisis... (~2-3 segundos)
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
            {state.insight.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brand-700 font-bold flex-shrink-0">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <footer className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {state.insight.isOverride ? "Editado por admin" : "Analisis generado por IA"}
            </span>
            <span>{new Date(state.insight.generatedAt).toLocaleDateString("es-PE")}</span>
          </footer>
        </>
      )}

      {state.kind === "error" && (
        <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">No se pudo generar el analisis</p>
            <p className="text-red-700 opacity-90 mt-0.5">{state.message}</p>
            {state.canRetry && (
              <button
                type="button"
                onClick={generate}
                className="mt-1.5 text-red-700 hover:text-red-900 underline text-[11px]"
              >
                Reintentar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
