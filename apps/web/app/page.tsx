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

/**
 * Landing publica de Aibenchef. Orden de secciones optimizado para
 * conversion B2B SaaS (patron Stripe/Linear/Vercel):
 *
 * 1. Hero — copy + credibilidad + mockup real (evidencia visual)
 * 2. ValueProps — por que existe el producto (4 pilares)
 * 3. ModuleShowcase — que hace (4 modulos con mini-mockups)
 * 4. ForWho — para quien es (4 personas)
 * 5. Coverage — que tan completo (numeros + 10 topicos)
 * 6. HowItWorks — como se usa (3 pasos)
 * 7. Comparison — vs alternativas (Excel / Consultora / Terminal financiera)
 * 8. Pricing — cuanto cuesta
 * 9. FAQ — objeciones frecuentes
 * 10. CTABanner — cierre final
 * 11. Footer
 */

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
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
