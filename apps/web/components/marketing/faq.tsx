import { Container, Section, SectionHeading } from "@/components/ui";

const faqs = [
  {
    q: "¿Puedo probar sin registrarme?",
    a: "Sí. Cada módulo tiene una demo interactiva pública con data real (BCP + 4 bancos comparables al último cierre) que puedes explorar sin crear cuenta. Ve al menú Producto arriba y elige el módulo que quieras probar. La demo tiene las mismas visualizaciones que la app completa; solo cambia que no puedes editar el peer group ni el período — para eso necesitas cuenta.",
  },
  {
    q: "¿De dónde sacan los datos?",
    a: "Directo de las publicaciones mensuales de la Superintendencia de Banca, Seguros y AFP (SBS). Los archivos .xls oficiales que cualquiera puede bajar, pero limpios, tipados, conectados y comparables.",
  },
  {
    q: "¿Cada cuánto se actualiza?",
    a: "Cada mes, automáticamente al día siguiente que la SBS publica el cierre (típicamente entre el día 30 y 45 después de fin de mes). Recibes un email cuando hay data nueva.",
  },
  {
    q: "¿Cuánto histórico tienen?",
    a: "Desde enero 2010 para todos los tópicos en todas las entidades supervisadas por SBS. 52 entidades activas al cierre actual y más de 100 con histórico (incluye entidades que se fusionaron o cambiaron de nombre en el camino) x 10 tópicos x 180+ meses.",
  },
  {
    q: "¿Es legal publicar esta data?",
    a: "Sí. La data SBS es pública por ley peruana. Aibenchef cobra por el procesamiento, la visualización y el acceso cómodo, no por la data en sí.",
  },
  {
    q: "¿Tienen API?",
    a: "Sí, disponible en el plan Business+. REST con autenticación JWT, paginación cursor-based, rate limits documentados. SDK en próximas versiones.",
  },
  {
    q: "¿Y si quiero data de mi propia entidad para combinar?",
    a: "El plan Enterprise permite cargar tus propios datos al lado de la data SBS. Ideal para benchmarking interno vs el sistema.",
  },
  {
    q: "¿Puedo cancelar en cualquier momento?",
    a: "Sí. Sin permanencia. Cancelas y al final del período facturado dejas de pagar. Conservas acceso hasta entonces.",
  },
  {
    q: "¿Aceptan factura electrónica peruana?",
    a: "Sí. Emitimos factura electrónica vía Nubefact cuando registres tu RUC al pagar.",
  },
];

export function FAQ() {
  return (
    <Section tone="muted" id="faq">
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
