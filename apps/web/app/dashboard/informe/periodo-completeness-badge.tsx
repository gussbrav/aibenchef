"use client";

/**
 * PeriodoCompletenessBadge — chip visual junto al "Cierre <Periodo>" que
 * indica el estado de publicacion SBS del periodo actual.
 *
 * Regla de mostrado (minimalista):
 *   - Si TODOS los topicos completos + EEFF completo -> renderiza null.
 *     Cero ruido visual cuando no hay nada que reportar.
 *   - Si EEFF completo pero hay topicos parciales/faltantes -> chip AMBAR
 *     "Datos secundarios pendientes (N)" con popover on-click detallado.
 *   - Si EEFF incompleto -> chip ROJO "EEFF publicacion parcial (N/5)"
 *     — caso raro, solo ocurre si el usuario elige manualmente un
 *     periodo muy reciente sin EEFF listo aun.
 *
 * Performance:
 *   - Componente <2KB gzipped
 *   - Sin deps nuevas (usa lucide-react que ya esta en el bundle)
 *   - Popover con state local (no re-renderiza el padre al abrir/cerrar)
 *   - Cierre automatico on click-outside via useRef
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle, X } from "lucide-react";

import type { PeriodoCompletenessStatus } from "@/lib/domains/informe/queries";

// Mapeo topico -> label legible castellano. Mantener en sync con los
// topicos SBS que scrapeamos. Los que no esten aca se muestran raw.
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

export function PeriodoCompletenessBadge({
  status,
}: {
  status: PeriodoCompletenessStatus | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside para cerrar el popover — mejor UX que solo boton X.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (!status) return null;

  const nParciales = status.topicos_parciales.length;
  const nFaltantes = status.topicos_faltantes.length;
  const eeffOk = status.eeff_completo;

  // Caso 1: todo OK -> no renderizar
  if (eeffOk && nParciales === 0 && nFaltantes === 0) return null;

  // Caso 2: EEFF incompleto (rojo)
  const isCritical = !eeffOk;
  const chipClass = isCritical
    ? "bg-red-500/20 hover:bg-red-500/30 border-red-300/50 text-white"
    : "bg-amber-400/25 hover:bg-amber-400/40 border-amber-200/50 text-white";
  const Icon = isCritical ? XCircle : AlertTriangle;
  const chipLabel = isCritical
    ? `EEFF parcial (${status.grupos_eeff_ok}/5)`
    : `${nParciales + nFaltantes} topico${nParciales + nFaltantes === 1 ? "" : "s"} pendiente${nParciales + nFaltantes === 1 ? "" : "s"}`;

  return (
    <div ref={rootRef} className="relative inline-flex no-print">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${chipClass}`}
        aria-label={`Estado de publicacion SBS: ${chipLabel}. Click para ver detalle.`}
        aria-expanded={open}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{chipLabel}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Detalle de publicacion SBS"
          className="absolute top-full left-0 mt-2 z-30 w-80 bg-white text-slate-900 rounded-lg shadow-xl border border-slate-200 overflow-hidden"
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

          <div className="p-3 space-y-2.5 text-xs">
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
        </div>
      )}
    </div>
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
