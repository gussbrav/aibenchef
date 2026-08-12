"use client";

/**
 * PlanBadge — chip visible en el header del dashboard que muestra el plan
 * comercial del user. Free/Pro/Business con colores distintos.
 *
 * Cuando el user esta en Free, el badge es CLICKEABLE — abre el UpgradeModal
 * con la comparativa Free vs Pro vs Business y CTA a la pagina de pricing.
 * Cuando esta en Pro/Business, es solo informativo (hover mostrara detalle
 * en futura iteracion).
 */

import { useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

import type { UserPlan } from "@/lib/plans";

const COLORS: Record<UserPlan, { bg: string; text: string; border: string; ring: string }> = {
  free: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
    ring: "hover:ring-brand-200",
  },
  pro: {
    bg: "bg-brand-50",
    text: "text-brand-800",
    border: "border-brand-200",
    ring: "",
  },
  business: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    ring: "",
  },
};

export function PlanBadge({ plan }: { plan: UserPlan }) {
  const [modalOpen, setModalOpen] = useState(false);
  const c = COLORS[plan];
  const isFree = plan === "free";

  return (
    <>
      {isFree ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full ${c.bg} ${c.text} border ${c.border} hover:ring-2 ${c.ring} text-[11px] font-semibold uppercase tracking-wider transition-all`}
          title="Sube a Pro para desbloquear más funcionalidades"
        >
          Plan Free
          <span className="text-[10px] font-normal opacity-70">· Subir</span>
        </button>
      ) : (
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full ${c.bg} ${c.text} border ${c.border} text-[11px] font-semibold uppercase tracking-wider`}
        >
          {plan === "pro" ? "Pro" : "Business"}
        </span>
      )}

      {modalOpen && <UpgradeModal onClose={() => setModalOpen(false)} />}
    </>
  );
}

/**
 * UpgradeModal — modal elegante con comparativa Free vs Pro vs Business.
 * Se puede lanzar desde el PlanBadge o desde cualquier feature bloqueada.
 * Exportado tambien para uso standalone (feature-gated actions).
 */
export function UpgradeModal({
  onClose,
  motivo,
}: {
  onClose: () => void;
  /** Feature especifica que gatillo el modal (ej: "exportar PDF"). Muestra
   *  contexto arriba: "Necesitas Pro para: exportar PDF". */
  motivo?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 py-5 border-b border-slate-200 bg-gradient-to-br from-brand-50 to-indigo-50">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-md hover:bg-white/70 text-slate-500"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h2 id="upgrade-modal-title" className="text-lg font-bold text-slate-900">
                Desbloquea más con Pro
              </h2>
              {motivo ? (
                <p className="text-sm text-slate-600 mt-0.5">
                  Necesitas <strong className="text-slate-900">{motivo}</strong> — está incluido
                  en Pro y Business.
                </p>
              ) : (
                <p className="text-sm text-slate-600 mt-0.5">
                  Compara los planes y elige el que mejor te sirve.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Comparativa */}
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PlanCard
              nombre="Free"
              precio="$0"
              descripcion="Actual"
              features={[
                "1 entidad propia + 2 competidores",
                "12 meses de histórico",
                "Benchmark, PE y DuPont",
              ]}
              current
            />
            <PlanCard
              nombre="Pro"
              precio="$149"
              descripcion="Más popular"
              features={[
                "10 competidores",
                "5 años de histórico",
                "Publicaciones AI (20/mes)",
                "Estados Financieros y Análisis",
                "Insights AI en el dashboard",
                "Export PDF + Excel",
              ]}
              highlighted
              ctaHref="/#planes"
            />
            <PlanCard
              nombre="Business"
              precio="$399"
              descripcion="Máximo alcance"
              features={[
                "Todo Pro sin límites",
                "API REST + JWT",
                "Publicaciones ilimitadas",
                "SLA + soporte dedicado",
                "White-label disponible",
              ]}
              ctaHref="/solicitar-acceso?plan=business"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] text-slate-500">
            Sin permanencia. Cancelas cuando quieras. Factura electrónica peruana.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-slate-600 hover:text-slate-900 font-medium"
          >
            Seguir con Free por ahora
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  nombre,
  precio,
  descripcion,
  features,
  current,
  highlighted,
  ctaHref,
}: {
  nombre: string;
  precio: string;
  descripcion: string;
  features: string[];
  current?: boolean;
  highlighted?: boolean;
  ctaHref?: string;
}) {
  const border = highlighted
    ? "border-brand-500 ring-2 ring-brand-100"
    : current
    ? "border-slate-200 bg-slate-50/50"
    : "border-slate-200";

  return (
    <div className={`rounded-lg border ${border} p-4 flex flex-col`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-900">{nombre}</h3>
        {highlighted && (
          <span className="text-[9px] uppercase tracking-wider font-bold text-brand-700 bg-brand-100 px-1.5 py-0.5 rounded">
            {descripcion}
          </span>
        )}
        {current && (
          <span className="text-[9px] uppercase tracking-wider font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
            {descripcion}
          </span>
        )}
      </div>
      <div className="mb-3">
        <span className="text-2xl font-bold text-slate-900">{precio}</span>
        <span className="text-xs text-slate-500 ml-1">/mes</span>
      </div>
      <ul className="space-y-1.5 text-[12px] text-slate-700 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-1.5">
            <span className="mt-1 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {ctaHref && !current && (
        <Link
          href={ctaHref as never}
          className={`mt-4 h-9 px-3 flex items-center justify-center gap-1 text-xs font-semibold rounded-md transition ${
            highlighted
              ? "bg-brand-600 hover:bg-brand-700 text-white"
              : "bg-slate-100 hover:bg-slate-200 text-slate-800"
          }`}
        >
          Subir a {nombre}
        </Link>
      )}
    </div>
  );
}
