import { Container } from "@/components/ui";
import type { ComponentType } from "react";

/**
 * Header estandar para cada demo publica — titulo grande + descripcion +
 * icono del modulo + row de chips de "params fijos" para que el user
 * entienda que se puede cambiar con cuenta.
 */
export function DemoHeader({
  icon: Icon,
  tag,
  titulo,
  descripcion,
  chips,
}: {
  icon: ComponentType<{ className?: string }>;
  tag: string;
  titulo: string;
  descripcion: string;
  chips: Array<{ label: string; value: string; fijo?: boolean }>;
}) {
  return (
    <section className="bg-white border-b border-slate-200 py-10">
      <Container size="xl">
        <div className="flex items-start gap-4 max-w-4xl">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center ring-1 ring-brand-100">
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold mb-1">
              {tag}
            </p>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">
              {titulo}
            </h1>
            <p className="text-sm md:text-base text-slate-600 leading-relaxed mt-2 max-w-2xl">
              {descripcion}
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 flex-wrap">
          {chips.map((c) => (
            <span
              key={c.label}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs ${
                c.fijo
                  ? "bg-amber-50 border border-amber-200 text-amber-900"
                  : "bg-slate-100 border border-slate-200 text-slate-700"
              }`}
            >
              <span className="text-slate-500 font-medium">{c.label}:</span>
              <span className="font-semibold">{c.value}</span>
              {c.fijo && (
                <span className="text-[10px] uppercase tracking-wider text-amber-700 font-bold ml-1">
                  fijo
                </span>
              )}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
}
