import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Container } from "@/components/ui";
import { DashboardMockup } from "./dashboard-mockup";

/**
 * Hero del landing publico. Estructura:
 * 1. Copy CTA (headline + subhead + botones + micro-copy promocion)
 * 2. Franja de credibilidad (4 metricas clave del producto)
 * 3. Mockup visual del /dashboard/informe (Cuadro Resumen real con data
 *    publica SBS). Ancla la promesa "dias a minutos" con evidencia visual.
 *
 * El mockup es un componente React (no PNG) — se ve nitido en cualquier
 * resolucion, pesa cero KB extra, y se puede iterar sin re-exportar imagenes.
 */

const credibilidad = [
  { valor: "50+", label: "entidades reguladas activas" },
  { valor: "desde 2010", label: "histórico mensual" },
  { valor: "Automático", label: "actualización mensual" },
  { valor: "100%", label: "auditable a nivel celda" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-brand-50/30 to-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(37,99,235,0.15),transparent)]"
      />
      <Container size="xl" className="py-20 lg:py-28">
        {/* Copy hero */}
        <div className="mx-auto max-w-4xl text-center space-y-7">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold tracking-wider uppercase text-brand-700 bg-brand-100 rounded-full border border-brand-200">
            <Sparkles className="w-3 h-3" />
            Nuevo · Publicaciones con gráficos AI
          </span>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Inteligencia financiera para
            <br />
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-brand-700 bg-clip-text text-transparent">
              el sistema financiero peruano
            </span>
          </h1>
          <p className="text-xl lg:text-2xl text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Bancos, financieras, cajas municipales, cajas rurales y empresas
            de créditos — los 5 grupos regulados por la SBS con toda su data
            pública limpia, comparada y visualizada. Sin descargar Excels ni
            armar tablas dinámicas. Decisión lista en minutos, no semanas.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-2">
            <Link href="/signup">
              <Button size="lg" className="group">
                Empezar gratis
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="#modulos">
              <Button size="lg" variant="outline">
                Explorar módulos
              </Button>
            </Link>
          </div>
          <p className="text-sm text-slate-500">
            Sin tarjeta, sin compromiso. Compara cualquier entidad contra sus pares en 30 segundos.
          </p>
        </div>

        {/* Franja de credibilidad */}
        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {credibilidad.map((c) => (
            <div key={c.label} className="text-center">
              <p className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                {c.valor}
              </p>
              <p className="text-xs md:text-sm text-slate-600 mt-1 leading-tight">
                {c.label}
              </p>
            </div>
          ))}
        </div>

        {/* Mockup del dashboard */}
        <div className="mt-16 max-w-6xl mx-auto">
          <DashboardMockup />
          <p className="text-center text-xs text-slate-500 mt-4 italic">
            Vista previa del Cuadro Resumen — Banca Múltiple peruana al cierre Jun 2026.
            Data pública oficial procesada automáticamente.
          </p>
        </div>
      </Container>
    </section>
  );
}
