import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Container, Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Accede a tu cuenta de Aibenchef.",
};

export default function LoginPage() {
  const googleEnabled = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

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
            Bienvenido de vuelta
          </h1>
          <p className="text-slate-600">
            Entra a tu cuenta para acceder a los dashboards.
          </p>
        </div>

        <Card variant="elevated" className="p-8">
          <LoginForm googleEnabled={googleEnabled} />
        </Card>

        <p className="text-sm text-slate-600 text-center mt-6">
          ¿Aún no tienes cuenta?{" "}
          <Link href="/signup" className="text-brand-600 hover:underline font-medium">
            Empieza gratis
          </Link>
        </p>
      </Container>
    </main>
  );
}
