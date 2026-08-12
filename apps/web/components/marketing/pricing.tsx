import Link from "next/link";
import { Check } from "lucide-react";
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
      "12 meses de histórico",
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
      "Exportar a PDF + Excel",
    ],
    cta: "Empezar prueba",
    highlighted: true,
  },
  {
    name: "Business",
    price: 399,
    description: "Para gerencias y consultoras que necesitan TODA la data.",
    features: [
      "Todo lo de Pro sin límites",
      "Publicaciones con IA ilimitadas",
      "API REST + autenticación JWT",
      "SLA + soporte dedicado",
      "White-label disponible",
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
        <p className="text-center text-sm text-slate-500 mt-12 max-w-2xl mx-auto">
          ¿Necesitás algo distinto? White-label, on-premise, integraciones a medida —{" "}
          <Link href={"/solicitar-acceso?plan=enterprise" as never} className="text-brand-600 hover:underline font-medium">
            hablemos del plan Enterprise
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
