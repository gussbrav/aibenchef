import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Button, Container, Section } from "@/components/ui";

/**
 * CTA final compartido por todas las demos publicas. Coloca al final
 * de cada /demo/{modulo} para converter visitantes.
 */
export function DemoCTA({
  titulo,
  features,
}: {
  titulo: string;
  features: string[];
}) {
  return (
    <Section tone="muted">
      <Container size="md">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 p-8 md:p-12 text-white">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_60%)]"
          />
          <div className="relative space-y-5">
            <h2 className="text-2xl md:text-3xl font-bold leading-tight">
              {titulo}
            </h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-white/90">
                  <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Link href={"/solicitar-acceso" as never}>
                <Button size="lg" className="bg-white text-brand-700 hover:bg-brand-50 group">
                  Empezar prueba gratis
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Link href="/#planes">
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
                  Ver planes
                </Button>
              </Link>
            </div>
            <p className="text-xs text-white/70">
              Sin tarjeta, sin compromiso. Cancelas cuando quieras.
            </p>
          </div>
        </div>
      </Container>
    </Section>
  );
}
