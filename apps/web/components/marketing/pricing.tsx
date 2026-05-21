import Link from "next/link";
import { Check } from "lucide-react";
import { Container, Section, SectionHeading, Card, Button } from "@/components/ui";

const plans = [
  {
    name: "Starter",
    price: 49,
    description: "Para analistas individuales empezando a explorar el sistema.",
    features: [
      "1 grupo de entidades (a eleccion)",
      "24 meses de historico",
      "1 usuario",
      "Exportar a PDF",
      "Soporte por email",
    ],
    cta: "Empezar trial",
    highlighted: false,
  },
  {
    name: "Pro",
    price: 149,
    description: "Para equipos de analisis con cobertura multi-segmento.",
    features: [
      "3 grupos de entidades",
      "60 meses de historico",
      "5 usuarios",
      "Exportar a PDF + Excel",
      "Comparador multi-entidad",
      "Soporte prioritario",
    ],
    cta: "Empezar trial",
    highlighted: true,
  },
  {
    name: "Business",
    price: 399,
    description: "Para gerencias y consultoras que necesitan TODA la data.",
    features: [
      "Todos los grupos + historico completo",
      "15 usuarios",
      "API metered (10k req/mes)",
      "Alertas automaticas",
      "Reportes mensuales en PDF",
      "Soporte dedicado + SLA",
    ],
    cta: "Empezar trial",
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <Section id="planes">
      <Container size="xl">
        <SectionHeading
          eyebrow="Planes"
          title="Pago mensual o anual, cancelas cuando quieras"
          description="Pricing transparente. Sin contratos largos, sin contactanos."
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
                  Mas popular
                </p>
              )}
              <h3 className="text-2xl font-bold text-slate-900">{plan.name}</h3>
              <p className="text-sm text-slate-600 mt-2 min-h-[2.5rem]">
                {plan.description}
              </p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-5xl font-bold text-slate-900">${plan.price}</span>
                <span className="text-slate-500">/mes</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                USD. Anual con 20% off disponible.
              </p>
              <ul className="mt-8 space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
                    <Check className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/waitlist" className="mt-8">
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
          ¿Necesitas mas usuarios, API ilimitada, white-label o SLA enterprise?{" "}
          <Link href="/waitlist?plan=enterprise" className="text-brand-600 hover:underline font-medium">
            Hablemos del plan Enterprise
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
