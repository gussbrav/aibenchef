import { Clock, BarChart3, Layers, Shield } from "lucide-react";
import { Container, Section, SectionHeading, Card } from "@/components/ui";

const valueProps = [
  {
    icon: Clock,
    title: "De días a minutos",
    description:
      "Lo que te toma armar cada mes con archivos oficiales sueltos, Aibenchef te lo entrega listo el día que la información se publica.",
  },
  {
    icon: BarChart3,
    title: "Comparativos al instante",
    description:
      "Entidad vs entidad, grupo vs grupo, evolución temporal, ratios regulatorios. Sin tablas dinámicas, sin fórmulas rotas.",
  },
  {
    icon: Layers,
    title: "Cobertura amplia",
    description:
      "Banca Múltiple, Financieras, Cajas Municipales, Cajas Rurales y EDPYMEs. Más de 50 entidades activas, histórico mensual desde 2010 (incluye cambios de nombre y fusiones).",
  },
  {
    icon: Shield,
    title: "Auditable y trazable",
    description:
      "Cada número enlaza a la fuente pública oficial. Cero magia, cero black box. Listo para presentar a directorio.",
  },
];

export function ValueProps() {
  return (
    <Section tone="muted">
      <Container size="xl">
        <SectionHeading
          eyebrow="Por qué Aibenchef"
          title="Decisiones más rápidas con la misma data pública"
          description="La información está publicada gratis por el regulador. Usarla toma días por mes. Resolvemos eso."
        />
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-6">
          {valueProps.map(({ icon: Icon, title, description }) => (
            <Card key={title} variant="elevated" className="p-8">
              <div className="flex items-start gap-5">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
                  <p className="text-slate-600 leading-relaxed">{description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Container>
    </Section>
  );
}
