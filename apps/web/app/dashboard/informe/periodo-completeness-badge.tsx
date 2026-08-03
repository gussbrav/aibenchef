"use client";

/**
 * PeriodoCompletenessBadge — chip visual junto al "Cierre <Periodo>" que
 * indica el estado de publicacion SBS del periodo actual.
 *
 * Regla de mostrado (minimalista):
 *   - Si TODOS los topicos completos + EEFF completo -> renderiza null.
 *     Cero ruido visual cuando no hay nada que reportar.
 *   - Si EEFF completo pero hay topicos parciales/faltantes -> chip AMBAR
 *     "N topicos pendientes" con popover on-click detallado.
 *   - Si EEFF incompleto -> chip ROJO "EEFF parcial (N/5)".
 *
 * Popover rendered via React Portal al document.body:
 *   - Escapa del stacking context del header (que tiene overflow-hidden)
 *   - Position fixed con coords calculadas via getBoundingClientRect
 *   - Se actualiza en scroll/resize (auto-close si el trigger sale del viewport)
 *   - z-index alto (9999) para estar encima de cualquier otro overlay
 *
 * Performance:
 *   - Componente <3KB gzipped, sin deps nuevas
 *   - Portal solo se monta cuando open=true (no bloatea el DOM cerrado)
 *   - Listeners solo activos cuando open=true (se remueven al cerrar)
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, XCircle, X } from "lucide-react";

import type { PeriodoCompletenessStatus } from "@/lib/domains/informe/queries";

// Mapeo topico -> label legible castellano.
const TOPICO_LABELS: Record<string, string> = {
  eeff: "Estados Financieros",
  colocaciones: "Colocaciones",
  depositos: "Depositos",
  castigos: "Castigos",
  clientes_ahorro: "Clientes Ahorro",
  clientes_credito: "Clientes Credito",
  creditos_depositos_geo: "Geo Creditos/Depositos",
  indicadores: "Indicadores Prudenciales",
  oficinas: "Oficinas",
  personal: "Personal",
  tasas_activas: "Tasas Activas",
  tasas_pasivas: "Tasas Pasivas",
};

const labelOf = (topico: string): string =>
  TOPICO_LABELS[topico] ??
  topico
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");

const POPOVER_WIDTH = 340;
const GAP = 8;

export function PeriodoCompletenessBadge({
  status,
}: {
  status: PeriodoCompletenessStatus | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Portal solo despues del mount para evitar hydration mismatch (SSR).
  useEffect(() => setMounted(true), []);

  // Calcular posicion del popover relative al trigger. Se llama al abrir
  // y al scroll/resize para mantener el popover pegado al trigger.
  const updateCoords = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Preferir debajo del trigger. Si no cabe, arriba.
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const popoverEstH = popoverRef.current?.offsetHeight ?? 380;

    let top = rect.bottom + GAP;
    if (top + popoverEstH > viewportH - 8) {
      // No cabe abajo -> ponerlo arriba del trigger
      top = Math.max(8, rect.top - popoverEstH - GAP);
    }

    // Alinear left al trigger, pero clamp al viewport (con 8px margin).
    let left = rect.left;
    if (left + POPOVER_WIDTH > viewportW - 8) {
      left = Math.max(8, viewportW - POPOVER_WIDTH - 8);
    }

    setCoords({ top, left });
  }, []);

  // Recalcular coords cuando se abre.
  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
  }, [open, updateCoords]);

  // Listeners de scroll/resize/click-outside/ESC.
  useEffect(() => {
    if (!open) return;

    const onScroll = () => updateCoords();
    const onResize = () => updateCoords();
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("scroll", onScroll, true); // capture=true para nested scrollers
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, updateCoords]);

  if (!status) return null;

  const nParciales = status.topicos_parciales.length;
  const nFaltantes = status.topicos_faltantes.length;
  const eeffOk = status.eeff_completo;

  // Todo OK -> no renderizar el chip
  if (eeffOk && nParciales === 0 && nFaltantes === 0) return null;

  const isCritical = !eeffOk;
  const chipClass = isCritical
    ? "bg-red-500/20 hover:bg-red-500/30 border-red-300/50 text-white"
    : "bg-amber-400/25 hover:bg-amber-400/40 border-amber-200/50 text-white";
  const Icon = isCritical ? XCircle : AlertTriangle;
  const totalPend = nParciales + nFaltantes;
  const chipLabel = isCritical
    ? `EEFF parcial (${status.grupos_eeff_ok}/5)`
    : `${totalPend} topico${totalPend === 1 ? "" : "s"} pendiente${totalPend === 1 ? "" : "s"}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`no-print inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${chipClass}`}
        aria-label={`Estado de publicacion SBS: ${chipLabel}. Click para ver detalle.`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{chipLabel}</span>
      </button>

      {open && mounted && coords &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Detalle de publicacion SBS"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: POPOVER_WIDTH,
              zIndex: 9999,
            }}
            className="no-print bg-white text-slate-900 rounded-lg shadow-2xl border border-slate-200 overflow-hidden"
          >
            <header className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Icon
                  className={`w-4 h-4 ${isCritical ? "text-red-600" : "text-amber-600"}`}
                  aria-hidden="true"
                />
                <h3 className="text-xs font-semibold text-slate-900">
                  Publicacion SBS · periodo {status.periodo}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700 -mr-1"
                aria-label="Cerrar detalle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </header>

            <div className="p-3 space-y-2.5 text-xs max-h-[70vh] overflow-y-auto">
              <StatusRow
                label="Estados Financieros (EEFF)"
                detail={`${status.grupos_eeff_ok} de 5 grupos regulados`}
                ok={eeffOk}
                critical={!eeffOk}
              />

              {status.topicos_completos.length > 0 && (
                <TopicoBlock
                  titulo="Publicados"
                  items={status.topicos_completos.filter((t) => t !== "eeff")}
                  variant="ok"
                />
              )}
              {status.topicos_parciales.length > 0 && (
                <TopicoBlock
                  titulo="Publicacion parcial"
                  items={status.topicos_parciales}
                  variant="warn"
                />
              )}
              {status.topicos_faltantes.length > 0 && (
                <TopicoBlock
                  titulo="No publicados aun por SBS"
                  items={status.topicos_faltantes}
                  variant="pending"
                />
              )}
            </div>

            <footer className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 leading-relaxed">
              SBS publica los estados financieros primero. Los reportes
              secundarios pueden tardar 2-4 semanas mas. El informe muestra
              los KPIs disponibles y deja los pendientes en{" "}
              <span className="font-mono">—</span> hasta que SBS los publique.
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}

function StatusRow({
  label,
  detail,
  ok,
  critical,
}: {
  label: string;
  detail: string;
  ok: boolean;
  critical?: boolean;
}) {
  const Icon = ok ? CheckCircle2 : critical ? XCircle : AlertTriangle;
  const color = ok
    ? "text-emerald-600"
    : critical
      ? "text-red-600"
      : "text-amber-600";
  return (
    <div className="flex items-start gap-2">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{label}</p>
        <p className="text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function TopicoBlock({
  titulo,
  items,
  variant,
}: {
  titulo: string;
  items: string[];
  variant: "ok" | "warn" | "pending";
}) {
  if (items.length === 0) return null;
  const chipClass =
    variant === "ok"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : variant === "warn"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
        {titulo}
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map((t) => (
          <span
            key={t}
            className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${chipClass}`}
          >
            {labelOf(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
