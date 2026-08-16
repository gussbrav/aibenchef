import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { Button, Container } from "@/components/ui";

/**
 * Layout compartido para todas las demos publicas /demo/*.
 *
 * UX:
 *  - Banner sticky top amarillo: recuerda que es vista publica + CTA
 *    prominente "Crea cuenta gratis" para captar leads.
 *  - Nav simplificada: logo + link "Volver al inicio" + CTA principal.
 *  - Sin sidebar del dashboard real (esta es vista de marketing).
 *  - Footer compacto con links a otras demos.
 *
 * Contenido: cero llamadas a DB, todo mockup React con data publica SBS
 * hardcoded. Cero superficie de ataque, cero rate limit necesario.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Banner sticky top — recordatorio permanente de que es vista publica */}
      <div className="sticky top-0 z-50 bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 border-b border-amber-200">
        <Container size="xl">
          <div className="flex items-center justify-between gap-3 py-2 flex-wrap">
            <div className="flex items-center gap-2 text-[13px] text-amber-900">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <span>
                <strong>Vista pública</strong> — para elegir tu propia entidad, peer group,
                período y descargar reportes,{" "}
                <Link href="/signup" className="underline font-semibold hover:text-amber-950">
                  crea tu cuenta gratis
                </Link>
                .
              </span>
            </div>
            <Link href="/signup" className="flex-shrink-0">
              <Button size="sm" className="group">
                Empezar gratis
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </Container>
      </div>

      {/* Nav minimalista — solo logo + volver + CTA principal */}
      <header className="bg-white border-b border-slate-200">
        <Container size="xl">
          <div className="flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
                A
              </div>
              <span className="font-bold text-slate-900 text-sm">Aibenchef</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 ml-1">
                Demo
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-1 text-[13px] text-slate-600">
              <Link href={"/demo/informe" as never} className="px-3 py-2 hover:text-slate-900">
                Informe
              </Link>
              <Link href={"/demo/dupont" as never} className="px-3 py-2 hover:text-slate-900">
                DuPont
              </Link>
              <Link href={"/demo/punto-equilibrio" as never} className="px-3 py-2 hover:text-slate-900">
                Punto Equilibrio
              </Link>
              <Link href={"/demo/publicaciones" as never} className="px-3 py-2 hover:text-slate-900">
                Publicaciones
              </Link>
            </nav>
            <Link href="/" className="text-[13px] text-slate-500 hover:text-slate-900">
              ← Volver al inicio
            </Link>
          </div>
        </Container>
      </header>

      <main className="flex-1">{children}</main>

      {/* Footer compacto */}
      <footer className="border-t border-slate-200 bg-white py-6">
        <Container size="xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <p>Análisis generado a partir de fuentes públicas oficiales</p>
            <div className="flex gap-4">
              <Link href="/" className="hover:text-slate-900">Inicio</Link>
              <Link href="/#planes" className="hover:text-slate-900">Planes</Link>
              <Link href="/#faq" className="hover:text-slate-900">FAQ</Link>
              <Link href="/signup" className="text-brand-700 font-semibold hover:text-brand-800">
                Empezar gratis
              </Link>
            </div>
          </div>
        </Container>
      </footer>
    </div>
  );
}
