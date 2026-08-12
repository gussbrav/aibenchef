/**
 * Seccion "Para quien es" — segmentacion en 4 personas. Sirve para que
 * el visitante se auto-identifique en <3 segundos y siga bajando.
 *
 * No usar copy generico ("empresas de todos los tamaños") — cada persona
 * tiene un "job to be done" concreto que Aibenchef resuelve.
 */

import { Briefcase, Building2, GraduationCap, ShieldCheck } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui";

const personas = [
  {
    icon: Building2,
    titulo: "Analistas bancarios",
    subtitulo: "Riesgos · Estrategia · Planeamiento",
    jobs: [
      "Reporte mensual del sistema para directorio",
      "Benchmark de mora, cobertura y rentabilidad vs peers",
      "Sustento de propuestas de tasa o cupo",
    ],
    color: "brand",
  },
  {
    icon: Briefcase,
    titulo: "Consultoras",
    subtitulo: "Análisis financiero · Riesgo · Estrategia",
    jobs: [
      "Informes de fundamentos con data auditable",
      "Comparativos multi-entidad reproducibles",
      "Reportes profesionales para clientes",
    ],
    color: "emerald",
  },
  {
    icon: GraduationCap,
    titulo: "Docentes y estudiantes",
    subtitulo: "Formación en finanzas y banca",
    jobs: [
      "Casos con data real, no ejemplos ficticios",
      "Series históricas desde 2010 sin descargar Excels",
      "Trabajos de investigación con fuente citable",
    ],
    color: "violet",
  },
  {
    icon: ShieldCheck,
    titulo: "Áreas de cumplimiento",
    subtitulo: "Compliance · Auditoría · Riesgo",
    jobs: [
      "Monitoreo de la exposición del sistema en tiempo real",
      "Alertas cuando se aleja del promedio del sector",
      "Trazabilidad hasta la fuente pública SBS",
    ],
    color: "amber",
  },
];

const colorClasses: Record<string, { bg: string; text: string; ring: string }> = {
  brand: { bg: "bg-brand-50", text: "text-brand-600", ring: "ring-brand-100" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-100" },
  violet: { bg: "bg-violet-50", text: "text-violet-600", ring: "ring-violet-100" },
  amber: { bg: "bg-amber-50", text: "text-amber-600", ring: "ring-amber-100" },
};

export function ForWho() {
  return (
    <Section tone="muted">
      <Container size="xl">
        <SectionHeading
          eyebrow="Para quién es"
          title="Si trabajas con data del sistema financiero peruano, es para ti"
          description="Cuatro perfiles que ya usan Aibenchef para responder a directorio, cliente o regulador con la misma data — pero sin las 8 horas de armado manual."
        />
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {personas.map(({ icon: Icon, titulo, subtitulo, jobs, color }) => {
            const c = colorClasses[color]!;
            return (
              <div
                key={titulo}
                className="relative flex flex-col rounded-2xl bg-white ring-1 ring-slate-200 p-6 hover:ring-slate-300 transition-all"
              >
                <div className={`w-11 h-11 rounded-xl ${c.bg} ${c.text} ring-1 ${c.ring} flex items-center justify-center mb-4`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-1">
                  {titulo}
                </h3>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-4">
                  {subtitulo}
                </p>
                <ul className="space-y-2 text-sm text-slate-600 flex-1">
                  {jobs.map((j) => (
                    <li key={j} className="flex items-start gap-2 leading-snug">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${c.text.replace("text-", "bg-")} flex-shrink-0`} />
                      <span>{j}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}
