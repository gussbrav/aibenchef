import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, ShieldCheck } from "lucide-react";

import { Container, Card } from "@/components/ui";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Crear cuenta gratis · Aibenchef",
  description:
    "Empieza gratis con Aibenchef en menos de un minuto. Sin tarjeta, sin compromiso. Análisis y comparaciones del sistema financiero peruano en un solo lugar.",
};

// SignupForm usa useSearchParams() para leer ?token=... del invitation flow.
// Force-dynamic evita el prerender estatico que no soporta search params.
export const dynamic = "force-dynamic";

/**
 * Signup page publica — self-serve por default, invitation flow como
 * alternativa (?token=xxx en la URL).
 *
 * Layout premium 2 columnas:
 *  - Izquierda: form (Google OAuth + email/password)
 *  - Derecha: trust panel (plan Free features + cifras honestas)
 */
export default function SignupPage() {
  // Google OAuth se muestra solo si el env var esta definido en el server.
  // Better Auth ya usa el flag internamente; aca solo lo comunicamos al UI.
  const googleEnabled = !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-brand-50/30 to-white py-8 md:py-12">
      <Container size="lg">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al inicio
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 md:gap-12 items-start">
          {/* Columna izquierda: form */}
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
                Empieza gratis
              </h1>
              <p className="text-slate-600 leading-relaxed">
                En menos de un minuto tienes acceso a la data del sistema financiero peruano.
                Sin tarjeta, sin compromiso.
              </p>
            </div>

            <Card variant="elevated" className="p-6 md:p-8">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cargando...
                  </div>
                }
              >
                <SignupForm googleEnabled={googleEnabled} />
              </Suspense>
            </Card>

            <p className="text-sm text-slate-600 text-center">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="text-brand-600 hover:underline font-medium">
                Entra aquí
              </Link>
            </p>
          </div>

          {/* Columna derecha: trust panel */}
          <aside className="lg:sticky lg:top-8 space-y-5">
            {/* Que incluye el plan Free */}
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[10px] uppercase tracking-wider font-bold border border-emerald-200">
                  Plan Free
                </span>
                <span className="text-sm text-slate-500">Siempre gratis</span>
              </div>
              <ul className="space-y-2.5 text-[13.5px] text-slate-700">
                <FeatureLi>Análisis actualizado con cada nueva publicación oficial</FeatureLi>
                <FeatureLi>1 entidad propia a elección</FeatureLi>
                <FeatureLi>2 competidores en peer group</FeatureLi>
                <FeatureLi>Cuadro Resumen, DuPont y Punto de Equilibrio</FeatureLi>
                <FeatureLi>1 publicación con AI por mes</FeatureLi>
                <FeatureLi>Cierre actual + 12 meses de histórico</FeatureLi>
              </ul>
              <p className="text-[11px] text-slate-500 pt-3 border-t border-slate-100">
                Si necesitas más entidades, peers, exportar a PDF o publicaciones ilimitadas,
                puedes subir a Pro cuando quieras.
              </p>
            </div>

            {/* Trust cifras honestas */}
            <div className="rounded-2xl bg-slate-900 text-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-300" />
                <p className="text-[11px] uppercase tracking-wider font-bold text-brand-300">
                  Data auditable
                </p>
              </div>
              <ul className="space-y-2.5 text-[13.5px] text-slate-200">
                <li>
                  <strong className="text-white">52 entidades</strong> reguladas activas al cierre actual
                </li>
                <li>
                  <strong className="text-white">100+ entidades</strong> con histórico desde 2010 (incluye fusiones y renombres)
                </li>
                <li>
                  <strong className="text-white">11 tópicos</strong> por entidad (EEFF, colocaciones, tasas, mora, etc.)
                </li>
                <li>Cada número enlaza a su fuente pública oficial</li>
              </ul>
            </div>

            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              Al crear tu cuenta aceptas nuestros{" "}
              <Link href="/terminos" className="underline hover:text-slate-700">
                términos
              </Link>{" "}
              y{" "}
              <Link href="/privacidad" className="underline hover:text-slate-700">
                política de privacidad
              </Link>
              .
            </p>
          </aside>
        </div>
      </Container>
    </main>
  );
}

function FeatureLi({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}
