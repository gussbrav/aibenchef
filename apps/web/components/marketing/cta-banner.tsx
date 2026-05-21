import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Button } from "@/components/ui";

export function CTABanner() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 lg:py-28">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(59,130,246,0.25),transparent)]"
      />
      <Container size="md" className="relative">
        <div className="text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white">
            Empeza con 50% off el primer trimestre
          </h2>
          <p className="text-lg text-slate-300 max-w-xl mx-auto">
            Sumate a la waitlist y entras al beta privado. Cupo limitado para asegurar
            calidad de servicio.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4">
            <Link href="/waitlist">
              <Button size="lg" className="group">
                Sumarme a la waitlist
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
