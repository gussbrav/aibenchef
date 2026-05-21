import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { ValueProps } from "@/components/marketing/value-props";
import { Coverage } from "@/components/marketing/coverage";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { FAQ } from "@/components/marketing/faq";
import { CTABanner } from "@/components/marketing/cta-banner";
import { Footer } from "@/components/marketing/footer";

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ValueProps />
        <Coverage />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <CTABanner />
      </main>
      <Footer />
    </>
  );
}
