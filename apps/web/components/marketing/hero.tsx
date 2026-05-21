import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Container, Badge } from "@/components/ui";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-brand-50/30 to-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(37,99,235,0.15),transparent)]"
      />
      <Container size="xl" className="py-24 lg:py-32">
        <div className="mx-auto max-w-4xl text-center space-y-8">
          <Badge>
            <Sparkles className="w-3 h-3" />
            Beta privada · Sumate antes que tu competencia
          </Badge>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 leading-[1.05]">
            Inteligencia financiera para
            <br />
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-brand-700 bg-clip-text text-transparent">
              la banca peruana
            </span>
          </h1>
          <p className="text-xl lg:text-2xl text-slate-600 leading-relaxed max-w-3xl mx-auto">
            Toda la data publica de la SBS limpia, comparada y visualizada. Sin
            descargar Excels, sin armar tablas dinamicas. Decision lista en minutos,
            no semanas.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Link href="/waitlist">
              <Button size="lg" className="group">
                Sumarme a la waitlist
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="#planes">
              <Button size="lg" variant="outline">
                Ver planes
              </Button>
            </Link>
          </div>
          <p className="text-sm text-slate-500 pt-2">
            Los primeros en la lista entran al beta con <strong className="text-slate-700">50% off el primer trimestre</strong>
          </p>
        </div>
      </Container>
    </section>
  );
}
