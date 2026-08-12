import { Container, Section, SectionHeading } from "@/components/ui";

const steps = [
  {
    n: "01",
    title: "Te registras gratis",
    description:
      "Login con Google o email en un click. Sin tarjeta de crédito. El plan Free te deja explorar tu entidad + 2 competidores desde el minuto uno.",
  },
  {
    n: "02",
    title: "Eliges tu entidad y peers",
    description:
      "Dashboards listos para Benchmark, DuPont, Punto de Equilibrio y Estados Financieros. Filtras por entidad, período y moneda.",
  },
  {
    n: "03",
    title: "Publicas o exportas",
    description:
      "Generas artículos con IA listos para LinkedIn en menos de un minuto, o exportas a PDF/Excel cuando activas el plan Pro.",
  },
];

export function HowItWorks() {
  return (
    <Section tone="muted">
      <Container size="xl">
        <SectionHeading
          eyebrow="Cómo funciona"
          title="Tres pasos, cero fricción"
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
