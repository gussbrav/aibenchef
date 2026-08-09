"use client";

/**
 * RenombresToggle — control unificado para el flag consolidar de renombres
 * historicos. Usado en las 3 vistas del dashboard (Benchmark, DuPont,
 * Punto Equilibrio) para consistencia UX.
 *
 * Semantica del flag consolidar:
 *   TRUE  = "Renombres unidos": aliases historicos se fusionan bajo el
 *           canonico actual (ej. 'Banco Compartamos' + 'Financiera
 *           Compartamos' → serie continua 2008-hoy).
 *   FALSE = "Renombres separados": cada canonico solo su ventana legal
 *           real (ej. 'Banco Compartamos' desde 2023, sin data previa).
 *
 * El default por vista se decide en cada page.tsx segun la semantica del
 * analisis (Benchmark y PE: true; DuPont: false). El componente es agnostico
 * al default — solo renderiza el estado actual.
 */

import { Link2, Link2Off } from "lucide-react";

export function RenombresToggle({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`h-8 px-3 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
        value
          ? "bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100"
          : "bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-200"
      } ${className ?? ""}`}
      title={
        value
          ? "Renombres UNIDOS: los aliases históricos se consolidan bajo el canónico actual (ej. 'Banco Compartamos' incluye su etapa como Financiera 2008-2023). Click para separarlos."
          : "Renombres SEPARADOS: cada entidad muestra solo su ventana legal (ej. 'Banco Compartamos' desde 2023). Click para consolidar la historia completa."
      }
      aria-pressed={value}
    >
      {value ? <Link2 className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
      {value ? "Renombres unidos" : "Renombres separados"}
    </button>
  );
}
