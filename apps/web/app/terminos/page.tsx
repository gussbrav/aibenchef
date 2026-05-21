import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui";

export const metadata: Metadata = {
  title: "Terminos y condiciones",
  description: "Terminos y condiciones de uso de Aibenchef.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "2026-05-21";

export default function TerminosPage() {
  return (
    <main className="min-h-screen bg-white py-16">
      <Container size="md">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al inicio
        </Link>

        <article className="prose prose-slate max-w-none">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Terminos y condiciones
          </h1>
          <p className="text-sm text-slate-500 mb-12">
            Ultima actualizacion: {LAST_UPDATED}
          </p>

          <Section title="1. Aceptacion">
            <p>
              Al acceder o usar Aibenchef (el &quot;Servicio&quot;) aceptas estos
              terminos. Si no estas de acuerdo, no uses el Servicio. El operador
              del Servicio es Azoramind con domicilio en Peru.
            </p>
          </Section>

          <Section title="2. Naturaleza del Servicio">
            <p>
              Aibenchef ofrece visualizacion y analisis de informacion publica
              publicada por la Superintendencia de Banca, Seguros y AFP del
              Peru (SBS). La data subyacente es publica; nuestro Servicio
              consiste en su procesamiento, comparacion, visualizacion y
              entrega a traves de una plataforma web.
            </p>
            <p>
              No somos asesores financieros ni regulatorios. La informacion no
              constituye recomendacion de inversion. Las decisiones que tomes
              con base en el Servicio son tu responsabilidad.
            </p>
          </Section>

          <Section title="3. Cuentas y suscripciones">
            <p>
              Para usar los planes pagos debes crear una cuenta con informacion
              veridica. Eres responsable de mantener la confidencialidad de tus
              credenciales. Las suscripciones son recurrentes hasta que las
              canceles desde la plataforma o por escrito a soporte@aibenchef.com.
            </p>
          </Section>

          <Section title="4. Facturacion">
            <p>
              Los pagos se procesan a traves de Stripe. Para clientes con RUC en
              Peru emitimos factura electronica via Nubefact. Los precios estan
              en USD salvo indicacion contraria. El IGV peruano se calcula
              cuando aplique.
            </p>
            <p>
              Si un pago falla, te notificaremos y tendras 7 dias para
              actualizar el metodo de pago antes de que el acceso pase a modo
              lectura.
            </p>
          </Section>

          <Section title="5. Uso aceptable">
            <p>No esta permitido:</p>
            <ul>
              <li>Revender o redistribuir la data o el Servicio sin autorizacion escrita.</li>
              <li>Hacer scraping automatizado del Servicio fuera de la API documentada.</li>
              <li>Compartir credenciales de acceso entre personas distintas.</li>
              <li>Usar el Servicio para fines ilegales o contra terceros.</li>
            </ul>
          </Section>

          <Section title="6. Disponibilidad y datos">
            <p>
              Hacemos esfuerzos razonables para mantener el Servicio disponible
              y los datos actualizados, pero no garantizamos uptime especifico
              salvo en planes Enterprise con SLA escrito. Los datos provienen
              de la SBS y los reflejamos tal cual los publica; cualquier error
              en la fuente se replicara.
            </p>
          </Section>

          <Section title="7. Limitacion de responsabilidad">
            <p>
              En la maxima medida permitida por la ley peruana, Azoramind no
              sera responsable por danos indirectos, incidentales o
              consecuentes derivados del uso del Servicio. La responsabilidad
              total no excedera el monto pagado en los ultimos 12 meses.
            </p>
          </Section>

          <Section title="8. Cambios">
            <p>
              Podemos modificar estos terminos. Si los cambios son materiales
              te avisaremos por email con al menos 30 dias de anticipacion.
              Continuar usando el Servicio tras la entrada en vigencia implica
              aceptacion.
            </p>
          </Section>

          <Section title="9. Ley aplicable">
            <p>
              Estos terminos se rigen por las leyes de la Republica del Peru.
              Cualquier controversia se resuelve en los tribunales de Lima
              Cercado.
            </p>
          </Section>

          <Section title="10. Contacto">
            <p>
              Cualquier consulta sobre estos terminos:{" "}
              <a href="mailto:legal@aibenchef.com" className="text-brand-600 hover:underline">
                legal@aibenchef.com
              </a>
            </p>
          </Section>
        </article>
      </Container>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 space-y-3">
      <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
      <div className="text-slate-700 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}
