import { Clock, BarChart3, Layers, Shield } from "lucide-react";
import { Container, Section, SectionHeading, Card } from "@/components/ui";

const valueProps = [
  {
    icon: Clock,
    title: "De días a minutos",
    description:
      "Lo que te toma armar manualmente cada mes con .xls de la SBS, Aibenchef te lo entrega listo el día 1 del cierre publicado.",
  },
  {
    icon: BarChart3,
    title: "Comparativos al instante",
    description:
      "Entidad vs entidad, grupo vs grupo, evolución temporal, ratios regulatorios. Sin tablas dinámicas, sin fórmulas rotas.",
  },
  {
    icon: Layers,
    title: "Cobertura total",
    description:
      "Banca Múltiple, Empresas Financieras, Cajas Municipales, Cajas Rurales y EDPYMEs. 200+ entidades, 10 tópicos, histórico desde 2010.",
  },
  {
    icon: Shield,
    title: "Auditable y trazable",
    description:
      "Cada número enlaza a su fuente original SBS. Cero magia. Cero black box. Listo para presentar a directorio o regulador.",
  },
];

export function ValueProps() {
  return (
    <Section tone="muted">
      <Container size="xl">
        <SectionHeading
          eyebrow="Por qué Aibenchef"
          title="Decisiones más rápidas con la misma data pública"
          description="La SBS publica todo gratis. El problema es que usarla toma días por mes. Resolvemos eso."
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
