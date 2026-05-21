import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  Button,
  Container,
  Input,
  Card,
  Badge,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Waitlist",
  description: "Sumate a la waitlist y entra al beta privado de Aibenchef con 50% off el primer trimestre.",
};

export default function WaitlistPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-brand-50/30 to-white py-12">
      <Container size="sm">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-12"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Link>

        <div className="space-y-3 mb-10">
          <Badge>
            <Sparkles className="w-3 h-3" />
            Cupo limitado al beta
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
            Sumate a la waitlist
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            Te avisamos por email cuando Aibenchef este disponible. Los primeros en
            la lista entran al beta con{" "}
            <strong className="text-slate-900">50% off el primer trimestre</strong>.
          </p>
        </div>

        <Card variant="elevated" className="p-8">
          <form action="/api/waitlist" method="post" className="space-y-5">
            <input type="hidden" name="source" value="waitlist-page" />

            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700"
              >
                Tu email *
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="tu@empresa.com"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="organization"
                className="block text-sm font-medium text-slate-700"
              >
                Empresa o institucion <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <Input
                id="organization"
                name="organization"
                type="text"
                placeholder="Ej: Caja Arequipa, MEF, consultora..."
              />
              <p className="text-xs text-slate-500">
                Nos ayuda a priorizar a quien le abrimos el beta primero.
              </p>
            </div>

            <Button type="submit" size="lg" fullWidth>
              Quiero acceso temprano
            </Button>
          </form>
        </Card>

        <p className="text-xs text-slate-500 text-center mt-6">
          Sin spam. Te avisamos solo cuando este listo. Al enviar aceptas nuestros{" "}
          <Link href="/terminos" className="underline">
            terminos
          </Link>{" "}
          y{" "}
          <Link href="/privacidad" className="underline">
            politica de privacidad
          </Link>
          .
        </p>
      </Container>
    </main>
  );
}
