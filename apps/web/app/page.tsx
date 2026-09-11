import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { ValueProps } from "@/components/marketing/value-props";
import { ModuleShowcase } from "@/components/marketing/module-showcase";
import { ForWho } from "@/components/marketing/for-who";
import { Coverage } from "@/components/marketing/coverage";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Comparison } from "@/components/marketing/comparison";
import { Pricing } from "@/components/marketing/pricing";
import { FAQ } from "@/components/marketing/faq";
import { CTABanner } from "@/components/marketing/cta-banner";
import { Footer } from "@/components/marketing/footer";
import { fetchMockupData } from "@/lib/domains/mockup-data";

/**
 * Landing publica de Aibenchef. Orden de secciones optimizado para
 * conversion B2B SaaS (patron Stripe/Linear/Vercel).
 *
 * ISR 24h: el Cuadro Resumen del hero se regenera con datos reales de la
 * DB una vez al dia. Si la DB no esta disponible en build time, usa el
 * JSON estatico pre-bakeado como fallback (el landing nunca queda vacio).
 */

// Revalidar cada 24 horas — el Cuadro Resumen siempre muestra el ultimo
// cierre publicado sin necesidad de hacer build nuevo ni correr scripts.
export const revalidate = 86400;

export default async function HomePage() {
  const mockupData = await fetchMockupData();
  return (
    <>
      <Nav />
      <main>
        <Hero mockupData={mockupData} />
        <ValueProps />
        <ModuleShowcase />
        <ForWho />
        <Coverage />
        <HowItWorks />
        <Comparison />
        <Pricing />
        <FAQ />
        <CTABanner />
      </main>
      <Footer />
    </>
  );
}
