import Link from "next/link";
import { Sparkles, ArrowRight, Check } from "lucide-react";

import { Container } from "@/components/ui";

/**
 * PlanUpgradePage — pantalla que se renderiza cuando un user Free intenta
 * entrar a una URL de feature Pro/Business (via link viejo, command palette
 * o typing directo). En vez de 404 o 403 crudo, muestra una landing elegante
 * con el valor de la feature y CTA a subir de plan.
 *
 * Usar desde el page.tsx:
 *   const plan = await getUserPlan(session.user.id);
 *   if (!admin && plan === "free") {
 *     return <PlanUpgradePage feature="publicaciones" ... />;
 *   }
 */
export function PlanUpgradePage({
  feature,
  titulo,
  descripcion,
  bullets,
  planRequerido = "Pro",
}: {
  /** slug corto — se muestra en el subtitulo ("Publicaciones ...") */
  feature: string;
  /** Titulo grande visible */
  titulo: string;
  /** Parrafo debajo del titulo explicando la feature */
  descripcion: string;
  /** Bullets con lo que incluye la feature */
  bullets: string[];
  /** Nombre del plan que la incluye. Default: "Pro" */
  planRequerido?: string;
}) {
  return (
    <Container size="xl" className="py-8">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
          {/* Hero */}
          <div className="relative px-8 py-10 bg-gradient-to-br from-brand-500 via-indigo-500 to-fuchsia-600 text-white">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80 mb-2">
                  Función del plan {planRequerido}
                </p>
                <h1 className="text-3xl font-bold leading-tight">{titulo}</h1>
                <p className="text-white/90 mt-2 text-[15px]">{descripcion}</p>
              </div>
            </div>
          </div>

          {/* Bullets */}
          <div className="px-8 py-6">
            <p className="text-sm font-semibold text-slate-900 mb-3">
              ¿Qué incluye {feature}?
            </p>
            <ul className="space-y-2.5">
              {bullets.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-2.5 text-sm text-slate-700"
                >
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <Check
                      className="w-2.5 h-2.5 text-emerald-700"
                      strokeWidth={3}
                    />
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="px-8 py-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-slate-600">
              Actualiza tu plan y desbloquea todo el potencial de Aibenchef.
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={"/dashboard" as never}
                className="h-10 px-4 inline-flex items-center text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                Volver al dashboard
              </Link>
              <Link
                href={"/#planes" as never}
                className="h-10 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md shadow-sm"
              >
                Ver planes
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
