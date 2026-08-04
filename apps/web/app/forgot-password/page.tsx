import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Container, Card } from "@/components/ui";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Restablecer contrasena",
  description: "Recibi un email con el link para elegir una nueva contrasena.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-brand-50/30 to-white py-12 flex items-center">
      <Container size="sm">
        <Link
          href="/login"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al login
        </Link>

        <div className="space-y-2 mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Olvidaste tu contrasena?
          </h1>
          <p className="text-slate-600">
            Ingresa tu email y te mandamos un link para elegir una nueva.
          </p>
        </div>

        <Card variant="elevated" className="p-8">
          <ForgotPasswordForm />
        </Card>
      </Container>
    </main>
  );
}
