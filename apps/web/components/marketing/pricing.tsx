import Link from "next/link";
import { Check, GraduationCap, ArrowRight } from "lucide-react";
import { Container, Section, SectionHeading, Card, Button } from "@/components/ui";

/**
 * Pricing publico — DEBE reflejar exactamente lo que enforcea el server
 * en apps/web/lib/plans.ts (PLAN_LIMITS). Si cambias limites aca sin
 * actualizar plans.ts, mentis al usuario. Si cambias plans.ts sin
 * actualizar aca, tenes UI desactualizada.
 *
 * Fuente de verdad: lib/plans.ts.
 */

const plans = [
  {
    name: "Free",
    price: 0,
    priceLabel: "Gratis",
    description: "Para probar la plataforma con tu entidad y ver el valor real.",
    features: [
      "1 entidad propia",
      "Hasta 2 competidores para comparar",
      "Últimos 2 años de histórico",
      "Benchmark ejecutivo (informe completo)",
      "Punto de Equilibrio y DuPont",
    ],
    cta: "Empezar gratis",
    highlighted: false,
  },
  {
    name: "Pro",
    price: 149,
    description: "Para analistas que arman informes mensuales de verdad.",
    features: [
      "Hasta 10 competidores por informe",
      "5 años de histórico completo",
      "Publicaciones con IA para LinkedIn (20/mes)",
      "Estados Financieros históricos y análisis dinámico",
      "Insights AI en el dashboard",
      "Exportar Benchmark a PDF + tabla a Excel",
      "API pública + MCP para Claude Desktop",
    ],
    cta: "Empezar prueba",
    highlighted: true,
  },
  {
    name: "Business",
    price: 399,
    description: "Para gerencias y consultoras que necesitan más volumen.",
    features: [
      "Todo lo de Pro sin límites",
      "Publicaciones con IA ilimitadas",
      "API pública con rate limits ampliados",
      "Colores del peer group personalizados",
      "Múltiples usuarios por organización",
      "Soporte prioritario por email",
    ],
    cta: "Hablemos",
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <Section id="planes">
      <Container size="xl">
        <SectionHeading
          eyebrow="Planes"
          title="Empezá gratis. Pagá cuando lo necesites."
          description="Sin permanencia. Cancelas cuando quieras. Precios en USD, factura electrónica peruana."
        />
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              variant={plan.highlighted ? "outlined" : "elevated"}
              className="flex flex-col p-8"
            >
              {plan.highlighted && (
                <p className="text-xs font-bold tracking-widest text-brand-600 uppercase mb-2">
                  Más popular
                </p>
              )}
              <h3 className="text-2xl font-bold text-slate-900">{plan.name}</h3>
              <p className="text-sm text-slate-600 mt-2 min-h-[2.5rem]">
                {plan.description}
              </p>
              <div className="mt-6 flex items-baseline gap-1">
                {plan.price === 0 ? (
                  <span className="text-5xl font-bold text-slate-900">
                    {plan.priceLabel ?? "Gratis"}
                  </span>
                ) : (
                  <>
                    <span className="text-5xl font-bold text-slate-900">
                      ${plan.price}
                    </span>
                    <span className="text-slate-500">/mes</span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 min-h-[1rem]">
                {plan.price === 0
                  ? "Sin tarjeta de crédito. Siempre gratis."
                  : "USD. Facturación mensual. Factura electrónica peruana."}
              </p>
              <ul className="mt-8 space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
                    <Check className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={plan.name === "Business" ? "/solicitar-acceso?plan=business" as never : "/signup"}
                className="mt-8"
              >
                <Button
                  fullWidth
                  size="lg"
                  variant={plan.highlighted ? "primary" : "outline"}
                >
                  {plan.cta}
                </Button>
              </Link>
            </Card>
          ))}
        </div>

        {/* Plan Académico — card destacada para tesistas/estudiantes.
            Target audience distinto (universitarios peruanos) que amerita
            separarlo del grid principal en vez de mezclarlo. */}
        <div className="mt-10 max-w-4xl mx-auto">
          <Card
            variant="elevated"
            className="p-6 md:p-8 border-2 border-sky-200 bg-gradient-to-br from-sky-50 via-white to-white"
          >
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center flex-shrink-0 shadow-md">
                <GraduationCap className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3 className="text-xl font-bold text-slate-900">
                    Plan Académico
                  </h3>
                  <span className="text-2xl font-bold text-slate-900">$9<span className="text-sm text-slate-500 font-normal">/mes</span></span>
                </div>
                <p className="text-sm text-slate-600 mt-1.5">
                  Para tesistas y estudiantes con email institucional peruano
                  (<span className="font-mono text-xs bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded">*.edu.pe</span>).
                  Verificación automática al registrarte.
                </p>
                <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                  {[
                    "5 años de histórico",
                    "Hasta 5 competidores",
                    "Benchmark, PE, DuPont, EEFF",
                    "Exportar a PDF + Excel",
                    "API pública + MCP para Claude Desktop",
                  ].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                href="/signup"
                className="w-full md:w-auto flex-shrink-0"
              >
                <Button size="lg" variant="outline" className="!border-sky-500 !text-sky-700 hover:!bg-sky-50 w-full md:w-auto">
                  Registrarme
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </Card>
        </div>

        <p className="text-center text-sm text-slate-500 mt-12 max-w-2xl mx-auto">
          ¿Necesitas white-label, on-premise, SLA con firma o integración a medida?{" "}
          <Link href={"/solicitar-acceso?plan=enterprise" as never} className="text-brand-600 hover:underline font-medium">
            Hablemos del plan Enterprise
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
