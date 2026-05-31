import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Container, Card } from "@/components/ui";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Restablecer contraseña",
  description: "Define una nueva contraseña para tu cuenta de Aibenchef.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
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
            Restablecer contraseña
          </h1>
          <p className="text-slate-600">
            Define una nueva contraseña. El link es de un solo uso y caduca en 1 hora.
          </p>
        </div>

        <Card variant="elevated" className="p-8">
          <ResetPasswordForm token={token} />
        </Card>
      </Container>
    </main>
  );
}
