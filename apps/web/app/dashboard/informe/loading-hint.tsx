"use client";

import { useEffect, useState } from "react";

/**
 * LoadingHint — mensaje contextual que rota mientras carga el /informe.
 *
 * Objetivo UX: durante los 10s de fetch de getInformeData, el usuario ve
 * mensajes tecnicos que explican QUE esta pasando en el backend. Esto
 * transforma la espera de 'app rota' a 'app trabajando'.
 *
 * Los mensajes reflejan las etapas reales del pipeline:
 * 1. Peer group discovery (dw.entidad_maestra)
 * 2. Datos EEFF por entidad (marts.mv_eeff_ratios)
 * 3. KPIs y comparativa (calculos en RSC)
 *
 * Rota cada 2.2s. Al llegar al ultimo mensaje se queda ahi (no cicla).
 */

const HINTS = [
  { icon: "🔎", text: "Resolviendo peer group SBS" },
  { icon: "📊", text: "Consultando estados financieros" },
  { icon: "📐", text: "Calculando ratios y benchmark" },
  { icon: "🎨", text: "Preparando visualización" },
];

export function LoadingHint() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((v) => Math.min(v + 1, HINTS.length - 1));
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 pt-3 pb-1 text-[13px] text-slate-500">
      <span className="text-base leading-none">{HINTS[idx]!.icon}</span>
      <span className="tabular-nums">{HINTS[idx]!.text}…</span>
      <span className="flex gap-1 ml-1">
        <span
          className="w-1 h-1 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </span>
    </div>
  );
}
