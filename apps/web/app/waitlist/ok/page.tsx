import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { Button, Container, Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Ya estás en la lista",
  description: "Gracias por sumarte a la waitlist de Aibenchef. Te avisamos por email cuando esté listo.",
};

export default function WaitlistOkPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-brand-50/30 to-white py-12 flex items-center">
      <Container size="sm">
        <Card variant="elevated" className="p-10 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              Ya estás en la lista
            </h1>
            <p className="text-lg text-slate-600 leading-relaxed">
              Te vamos a avisar por email apenas revisemos tu solicitud.
              Mientras tanto, puedes <Link href={"/demo/informe" as never} className="text-brand-700 hover:text-brand-800 font-medium underline">explorar las demos públicas</Link> del producto.
            </p>
          </div>
          <div className="pt-2">
            <Link href="/">
              <Button size="lg" variant="outline">
                Volver al inicio
              </Button>
            </Link>
          </div>
          <p className="text-xs text-slate-500 pt-6 border-t border-slate-200">
            ¿Conoces a alguien que también lo necesita? Compártele el link{" "}
            <span className="font-mono text-slate-700">aibenchef.azoramind.com</span>
          </p>
        </Card>
      </Container>
    </main>
  );
}
