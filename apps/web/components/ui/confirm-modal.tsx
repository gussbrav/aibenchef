"use client";

/**
 * Confirm modal reusable + hook `useConfirm()`.
 *
 * Reemplaza `window.confirm(...)` por un modal de la app (theme consistente,
 * destructive variant, evita el dialog feo del browser). Uso:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Eliminar widget",
 *     message: "Esta accion no se puede deshacer.",
 *     confirmLabel: "Eliminar",
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * Requiere envolver el arbol con <ConfirmModalProvider> (en dashboard/layout).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Resolver = (value: boolean) => void;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(
  null,
);

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback al confirm nativo si el provider no esta montado — evita que
    // el componente crashee en contextos sin provider (storybook, tests).
    return async (opts) => {
      const text = opts.message ? `${opts.title}\n\n${opts.message}` : opts.title;
      return typeof window !== "undefined" && window.confirm(text);
    };
  }
  return ctx;
}

export function ConfirmModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: Resolver;
  } | null>(null);
  const [working, setWorking] = useState(false);

  const open = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ opts, resolve });
      }),
    [],
  );

  // Cerrar con Escape (cancela) y Enter (confirma).
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter") finish(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const finish = (ok: boolean) => {
    if (!state) return;
    setWorking(false);
    state.resolve(ok);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={open}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => !working && finish(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start gap-3">
                {state.opts.destructive && (
                  <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                  </div>
                )}
                <div className="min-w-0">
                  <h2
                    id="confirm-modal-title"
                    className="text-base font-bold text-slate-900"
                  >
                    {state.opts.title}
                  </h2>
                  {state.opts.message && (
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                      {state.opts.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => finish(false)}
                disabled={working}
                className="px-4 h-9 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded"
              >
                {state.opts.cancelLabel ?? "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorking(true);
                  finish(true);
                }}
                disabled={working}
                autoFocus
                className={cn(
                  "px-4 h-9 text-sm font-medium text-white disabled:opacity-50 rounded inline-flex items-center gap-1.5",
                  state.opts.destructive
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-brand-600 hover:bg-brand-700",
                )}
              >
                {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {state.opts.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
