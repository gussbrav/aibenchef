import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Container, Card } from "@/components/ui";
import { RequestAccessForm } from "./request-access-form";

export const metadata: Metadata = {
  title: "Solicitar acceso",
  description:
    "Solicita una invitacion contandonos brevemente quien eres y para que lo quieres usar.",
};

export default function SolicitarAccesoPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-brand-50/30 to-white py-12">
      <Container size="md">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Link>

        <div className="space-y-2 mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Solicita acceso al beta
          </h1>
          <p className="text-slate-600 max-w-xl mx-auto">
            Aibenchef es una plataforma para entidades del sistema financiero peruano.
            Cuéntanos quién eres en 30 segundos y te respondemos en 24–48h hábiles.
          </p>
        </div>

        <Card variant="elevated" className="p-6 md:p-8">
          <RequestAccessForm />
        </Card>

        <p className="text-sm text-slate-600 text-center mt-6">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-brand-600 hover:underline font-medium">
            Entra aquí
          </Link>
        </p>
      </Container>
    </main>
  );
}
