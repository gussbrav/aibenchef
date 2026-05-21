import { Container, Section, SectionHeading } from "@/components/ui";

const faqs = [
  {
    q: "¿De donde sacan los datos?",
    a: "Directo de las publicaciones mensuales de la Superintendencia de Banca, Seguros y AFP (SBS). Los archivos .xls oficiales que cualquiera puede bajar, pero limpios, tipados, conectados y comparables.",
  },
  {
    q: "¿Cada cuanto se actualiza?",
    a: "Cada mes, automaticamente al dia siguiente que la SBS publica el cierre (tipicamente entre el dia 30 y 45 despues de fin de mes). Recibis email cuando hay data nueva.",
  },
  {
    q: "¿Cuanto historico tienen?",
    a: "Desde enero 2010 para todos los topicos en todas las entidades supervisadas. Mas de 200 entidades x 10 topicos x 180+ meses.",
  },
  {
    q: "¿Es legal disponibilizar esta data?",
    a: "Si. La data SBS es publica por ley peruana. Aibenchef cobra por el procesamiento, la visualizacion y el acceso comodo, no por la data en si.",
  },
  {
    q: "¿Tienen API?",
    a: "Si, disponible en el plan Business+. REST con autenticacion JWT, paginacion cursor-based, rate limits documentados. SDK en proximas versiones.",
  },
  {
    q: "¿Y si quiero data de mi propia entidad para combinar?",
    a: "El plan Enterprise permite cargar tus propios datos al lado de la data SBS. Ideal para benchmarking interno vs el sistema.",
  },
  {
    q: "¿Puedo cancelar en cualquier momento?",
    a: "Si. Sin permanencia. Cancelas y al final del periodo facturado dejas de pagar. Conservas acceso hasta entonces.",
  },
  {
    q: "¿Aceptan factura electronica peruana?",
    a: "Si. Emitimos factura electronica via Nubefact cuando registres tu RUC al pagar.",
  },
];

export function FAQ() {
  return (
    <Section tone="muted">
      <Container size="md">
        <SectionHeading
          eyebrow="Preguntas frecuentes"
          title="Lo que la gente nos pregunta"
        />
        <div className="mt-16 space-y-4">
          {faqs.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-xl border border-slate-200 bg-white p-6 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center justify-between cursor-pointer text-base font-semibold text-slate-900">
                {q}
                <span className="text-brand-600 ml-4 transition-transform group-open:rotate-45">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
              </summary>
              <p className="mt-4 text-slate-600 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  );
}
