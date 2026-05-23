"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Copy } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Renderiza un error de API de forma consistente.
 *
 * Espera el shape estandar de nuestro handleRoute:
 *   { code, message, requestId, gitSha, hint?, detail?, stack? }
 */
export type ApiError = {
  code?: string;
  message?: string;
  requestId?: string;
  gitSha?: string;
  hint?: string;
  detail?: string;
  stack?: string;
  dbCode?: string;
  dbDetail?: string;
  dbHint?: string;
  dbTable?: string;
  dbConstraint?: string;
};

export function ErrorBox({
  error,
  className,
}: {
  error: ApiError | string | null | undefined;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!error) return null;
  const e: ApiError = typeof error === "string" ? { message: error } : error;
  const hasDetail = Boolean(e.detail || e.stack || e.dbDetail || e.dbHint);

  const copiar = () => {
    const id = e.requestId ?? "";
    if (id) navigator.clipboard?.writeText(id).catch(() => {});
  };

  return (
    <div
      className={cn(
        "rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-900",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-600" />
        <div className="flex-1 min-w-0">
          <p className="font-medium">{e.message ?? "Error desconocido"}</p>
          {e.hint && <p className="text-xs text-rose-800 mt-0.5">{e.hint}</p>}

          {(e.requestId || e.gitSha || e.code) && (
            <div className="flex flex-wrap gap-1 mt-2 text-[10px] font-mono">
              {e.code && (
                <span className="px-1.5 py-0.5 bg-white border border-rose-200 rounded text-rose-700">
                  {e.code}
                </span>
              )}
              {e.requestId && (
                <button
                  type="button"
                  onClick={copiar}
                  className="px-1.5 py-0.5 bg-white border border-rose-200 rounded text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1"
                  title="Click para copiar"
                >
                  id: {e.requestId}
                  <Copy className="w-2.5 h-2.5" />
                </button>
              )}
              {e.gitSha && (
                <span className="px-1.5 py-0.5 bg-white border border-rose-200 rounded text-slate-600">
                  build: {e.gitSha}
                </span>
              )}
            </div>
          )}

          {hasDetail && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[10px] text-rose-700 hover:underline inline-flex items-center gap-1"
              >
                {expanded ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                {expanded ? "Ocultar" : "Ver"} detalle tecnico
              </button>
              {expanded && (
                <pre className="mt-1 p-2 bg-white border border-rose-200 rounded text-[10px] font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto max-h-48">
                  {[
                    e.detail && `Detail: ${e.detail}`,
                    e.dbDetail && `DB detail: ${e.dbDetail}`,
                    e.dbHint && `DB hint: ${e.dbHint}`,
                    e.dbTable && `DB table: ${e.dbTable}`,
                    e.dbConstraint && `DB constraint: ${e.dbConstraint}`,
                    e.stack && `\n${e.stack}`,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Helper: extrae el ApiError de cualquier respuesta JSON de nuestros endpoints.
 */
export function parseApiError(json: unknown): ApiError | null {
  if (json && typeof json === "object" && "error" in json) {
    const e = (json as { error: unknown }).error;
    if (e && typeof e === "object") return e as ApiError;
    if (typeof e === "string") return { message: e };
  }
  return null;
}
