import { Container, Section, SectionHeading } from "@/components/ui";

const steps = [
  {
    n: "01",
    title: "Te suscribis",
    description:
      "Eliges el plan que mejor calza con tu equipo. Trial de 14 dias sin tarjeta para los planes Starter y Pro.",
  },
  {
    n: "02",
    title: "Accedes a la plataforma",
    description:
      "Dashboards listos para EEFF, Colocaciones, Depositos, Indicadores y mas. Filtras por entidad, periodo y moneda.",
  },
  {
    n: "03",
    title: "Decides con datos",
    description:
      "Exportas a PDF para directorio, a Excel para seguir trabajando, o consumes via API si necesitas integrar.",
  },
];

export function HowItWorks() {
  return (
    <Section tone="muted">
      <Container size="xl">
        <SectionHeading
          eyebrow="Como funciona"
          title="Tres pasos, cero friccion"
        />
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((s) => (
            <div key={s.n} className="relative">
              <div className="absolute -top-2 -left-2 text-6xl font-bold text-brand-100 select-none">
                {s.n}
              </div>
              <div className="relative pt-8 pl-4">
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  {s.title}
                </h3>
                <p className="text-slate-600 leading-relaxed">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
