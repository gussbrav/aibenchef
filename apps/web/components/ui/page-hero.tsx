/**
 * PageHero — header premium reutilizable para páginas tipo "Datos" y "Análisis".
 *
 * Diseño: gradiente sutil + icono grande + título + tagline + (opcional) acción
 * principal a la derecha + (opcional) chips de stats abajo.
 *
 * Uso:
 *   <PageHero
 *     icon={LayoutDashboard}
 *     iconBg="from-indigo-500 to-purple-600"
 *     title="Tableros"
 *     tagline="Dashboards multi-widget para presentar KPIs a tu directorio"
 *     stats={[
 *       { label: "Tableros creados", value: 12 },
 *       { label: "Última edición", value: "hoy" },
 *     ]}
 *     action={<NewTableroButton />}
 *   />
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type PageHeroStat = {
  label: string;
  value: string | number;
  hint?: string;
};

export function PageHero({
  icon: Icon,
  iconBg = "from-brand-500 to-brand-700",
  title,
  tagline,
  description,
  stats,
  action,
}: {
  icon: LucideIcon;
  /** Tailwind gradient classes for the icon background (without `bg-gradient-to-br`). */
  iconBg?: string;
  title: string;
  /** Una sola línea — el "qué es" y "para quién" sintetizado. */
  tagline: string;
  /** Párrafo más largo opcional con detalle. */
  description?: string;
  stats?: PageHeroStat[];
  action?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50">
      {/* Decorative blob */}
      <div
        aria-hidden
        className={`absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br ${iconBg} opacity-10 blur-3xl pointer-events-none`}
      />
      <div className="relative p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div
              className={`flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${iconBg} flex items-center justify-center text-white shadow-md`}
            >
              <Icon className="w-6 h-6" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {title}
              </h1>
              <p className="text-sm text-slate-600 mt-1">{tagline}</p>
              {description && (
                <p className="text-xs text-slate-500 mt-2 max-w-2xl">{description}</p>
              )}
            </div>
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>

        {stats && stats.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            {stats.map((s) => (
              <div
                key={s.label}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm"
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  {s.label}
                </div>
                <div className="text-sm font-bold text-slate-900 tabular-nums">
                  {s.value}
                </div>
                {s.hint && <div className="text-[10px] text-slate-400">{s.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Card de "qué puedes hacer aquí" para empty states. */
export function FeatureTile({
  icon: Icon,
  title,
  description,
  color = "text-brand-600",
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 transition">
      <Icon className={`w-5 h-5 ${color} mb-2`} />
      <h3 className="text-sm font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
    </div>
  );
}
