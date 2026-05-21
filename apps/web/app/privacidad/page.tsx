import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui";

export const metadata: Metadata = {
  title: "Politica de privacidad",
  description: "Como Aibenchef trata tus datos personales conforme a la Ley 29733 de Proteccion de Datos Personales del Peru.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "2026-05-21";

export default function PrivacidadPage() {
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
            Politica de privacidad
          </h1>
          <p className="text-sm text-slate-500 mb-12">
            Ultima actualizacion: {LAST_UPDATED}
          </p>

          <Section title="1. Responsable del tratamiento">
            <p>
              Azoramind, con sede en Peru, es responsable del tratamiento de tus
              datos personales conforme a la Ley N° 29733 (Ley de Proteccion de
              Datos Personales) y su Reglamento.
            </p>
            <p>
              Contacto del responsable:{" "}
              <a href="mailto:privacidad@aibenchef.com" className="text-brand-600 hover:underline">
                privacidad@aibenchef.com
              </a>
            </p>
          </Section>

          <Section title="2. Que datos recopilamos">
            <ul>
              <li>
                <strong>De la waitlist:</strong> email, organizacion (opcional),
                IP, User-Agent, fuente y parametros UTM.
              </li>
              <li>
                <strong>De usuarios registrados:</strong> email, nombre, password
                cifrado, organizacion, rol dentro de la organizacion.
              </li>
              <li>
                <strong>De uso del producto:</strong> logs de acceso, queries
                ejecutadas, dashboards consultados, exportaciones generadas.
              </li>
              <li>
                <strong>De facturacion:</strong> RUC, razon social, direccion
                fiscal, datos de tarjeta procesados por Stripe (no almacenamos
                el numero completo en nuestros servidores).
              </li>
            </ul>
          </Section>

          <Section title="3. Para que los usamos">
            <ul>
              <li>Proveer y mejorar el Servicio.</li>
              <li>Comunicarnos contigo sobre el Servicio y el lanzamiento.</li>
              <li>Procesar pagos y emitir comprobantes electronicos.</li>
              <li>Cumplir obligaciones legales (Sunat, Indecopi, ANPD).</li>
              <li>Detectar y prevenir fraude o abuso del Servicio.</li>
            </ul>
            <p>
              <strong>No vendemos tus datos.</strong> No compartimos tu email con
              terceros para publicidad.
            </p>
          </Section>

          <Section title="4. Con quien los compartimos">
            <p>Proveedores que procesan datos por nuestra cuenta:</p>
            <ul>
              <li>Stripe (procesamiento de pagos).</li>
              <li>Nubefact (emision de facturas electronicas).</li>
              <li>Resend (envio de emails transaccionales).</li>
              <li>Cloudflare (CDN y DNS).</li>
            </ul>
            <p>
              Todos los proveedores tienen contratos de tratamiento de datos
              vigentes. Tu data sigue siendo nuestra responsabilidad.
            </p>
          </Section>

          <Section title="5. Donde se almacenan">
            <p>
              Tus datos se almacenan en servidores propios alojados en Hetzner
              (Alemania, UE) y en bases de datos PostgreSQL. Aplicamos cifrado
              en transito (TLS 1.3) y en reposo, y backups diarios con
              retencion de 30 dias.
            </p>
          </Section>

          <Section title="6. Por cuanto tiempo">
            <p>
              Conservamos tus datos mientras tengas cuenta activa y hasta 5
              anos despues de su cancelacion para fines legales y contables.
              Las entradas de waitlist se conservan hasta que pidas su
              eliminacion.
            </p>
          </Section>

          <Section title="7. Tus derechos">
            <p>
              Conforme a la Ley 29733 tenes derecho a acceso, rectificacion,
              cancelacion, oposicion, informacion y revocacion del
              consentimiento sobre tus datos. Ejercelos escribiendo a{" "}
              <a href="mailto:privacidad@aibenchef.com" className="text-brand-600 hover:underline">
                privacidad@aibenchef.com
              </a>{" "}
              con copia de tu DNI o documento de identidad. Respondemos en un
              maximo de 20 dias habiles.
            </p>
            <p>
              Si consideras que vulneramos tus derechos podes presentar reclamo
              ante la Autoridad Nacional de Proteccion de Datos Personales
              (ANPD - MINJUS).
            </p>
          </Section>

          <Section title="8. Cookies">
            <p>
              Usamos cookies tecnicas necesarias para el funcionamiento del
              Servicio (sesion, preferencias). No usamos cookies de terceros
              para publicidad. PostHog se usa unicamente para analytics
              anonimizado de uso del producto.
            </p>
          </Section>

          <Section title="9. Menores de edad">
            <p>
              El Servicio no esta dirigido a menores de 18 anos. No
              recolectamos data de menores intencionalmente.
            </p>
          </Section>

          <Section title="10. Cambios a esta politica">
            <p>
              Si actualizamos esta politica te avisaremos por email cuando los
              cambios sean materiales. La version vigente siempre esta en esta
              URL.
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
