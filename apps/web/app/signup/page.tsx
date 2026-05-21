import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Container, Card } from "@/components/ui";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta en Aibenchef.",
};

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-brand-50/30 to-white py-12 flex items-center">
      <Container size="sm">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Link>

        <div className="space-y-2 mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Crea tu cuenta
          </h1>
          <p className="text-slate-600">
            Acceso al beta privado. Necesitas estar en la waitlist o tener invitación.
          </p>
        </div>

        <Card variant="elevated" className="p-8">
          <SignupForm />
        </Card>

        <p className="text-sm text-slate-600 text-center mt-6">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-brand-600 hover:underline font-medium">
            Entra acá
          </Link>
        </p>
      </Container>
    </main>
  );
}
