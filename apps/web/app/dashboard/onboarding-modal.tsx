"use client";

/**
 * OnboardingModal — tour de bienvenida que se muestra la PRIMERA vez que
 * el usuario entra al dashboard (V167).
 *
 * Trigger: server component (page.tsx) chequea getUserOnboarded(). Si es
 * false, renderiza este componente. Al terminar el tour (o al saltarlo),
 * POST /api/v1/me/onboarded persiste el flag para que no vuelva a aparecer.
 *
 * Diseño: modal full-viewport, backdrop blur, 4 slides con progreso.
 * No bloquea navegacion — el usuario puede saltar en cualquier momento y
 * queda igual marcado como onboarded (asumimos que ya vio la existencia).
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  FileText,
  Sparkles,
  X,
  Check,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type Slide = {
  icono: React.ComponentType<{ className?: string }>;
  colorBg: string;
  colorText: string;
  titulo: string;
  descripcion: string;
  bullets: string[];
  ctaHref?: string;
  ctaLabel?: string;
};

const SLIDES: Slide[] = [
  {
    icono: Sparkles,
    colorBg: "bg-gradient-to-br from-brand-500 to-indigo-600",
    colorText: "text-white",
    titulo: "Bienvenido a Aibenchef",
    descripcion:
      "Inteligencia competitiva instantanea sobre las 52 entidades financieras reguladas por la SBS. Data publica, sin descargar archivos ni cuadrar planillas.",
    bullets: [
      "Datos oficiales SBS actualizados mes a mes",
      "Comparativas contra cualquier peer group",
      "Analisis DuPont, Punto de Equilibrio y mas",
    ],
  },
  {
    icono: BarChart3,
    colorBg: "bg-gradient-to-br from-emerald-500 to-teal-600",
    colorText: "text-white",
    titulo: "Benchmark en 3 clicks",
    descripcion:
      "Elegi tu entidad, elegi contra quien compararte, y en segundos tenes el informe. Sin SQL, sin Excel, sin esperar a que TI te pase la data.",
    bullets: [
      "Balance General + Estado de Resultados",
      "Ratios clave: ROA, ROE, Mora, Eficiencia, IRL",
      "Grafica evolucion 12 meses moviles",
    ],
    ctaHref: "/dashboard/informe",
    ctaLabel: "Ver el Benchmark",
  },
  {
    icono: FileText,
    colorBg: "bg-gradient-to-br from-violet-500 to-fuchsia-600",
    colorText: "text-white",
    titulo: "Publicaciones con IA",
    descripcion:
      "Generas un articulo listo para LinkedIn en menos de un minuto. Tema, entidad, peer group — y la IA arma la narrativa con los numeros correctos.",
    bullets: [
      "6 temas: Benchmarking, Mora, Rentabilidad, DuPont, PE, Macro",
      "Graficos SVG embebidos en TODOS los articulos",
      "Plan Free: 1 publicacion al mes",
    ],
    ctaHref: "/dashboard/publicaciones",
    ctaLabel: "Ir a Publicaciones",
  },
  {
    icono: Building2,
    colorBg: "bg-gradient-to-br from-amber-500 to-orange-600",
    colorText: "text-white",
    titulo: "Estas listo",
    descripcion:
      "Empeza explorando el Resumen del sistema o salta directo a tu entidad favorita. Cualquier duda, Ctrl+K abre el buscador global.",
    bullets: [
      "Resumen: pulso del sistema en una pantalla",
      "Estados Financieros: cualquier entidad, cualquier periodo",
      "Aiben (proximamente): pregunta en lenguaje natural",
    ],
  },
];

export function OnboardingModal() {
  const [slideIdx, setSlideIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [posting, setPosting] = useState(false);

  const marcarOnboarded = useCallback(async () => {
    setPosting(true);
    try {
      await fetch("/api/v1/me/onboarded", { method: "POST" });
    } catch {
      // silencio — la proxima carga vuelve a intentar, no es critico
    } finally {
      setPosting(false);
      setVisible(false);
    }
  }, []);

  const siguiente = useCallback(() => {
    if (slideIdx < SLIDES.length - 1) {
      setSlideIdx((s) => s + 1);
    } else {
      void marcarOnboarded();
    }
  }, [slideIdx, marcarOnboarded]);

  const anterior = useCallback(() => {
    setSlideIdx((s) => Math.max(0, s - 1));
  }, []);

  if (!visible) return null;

  const slide = SLIDES[slideIdx];
  if (!slide) return null;
  const Icono = slide.icono;
  const esUltimo = slideIdx === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header con hero visual del slide */}
        <div className={cn("relative px-8 py-8", slide.colorBg)}>
          <button
            type="button"
            onClick={marcarOnboarded}
            className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-white/20 text-white/80 hover:text-white transition"
            aria-label="Saltar tour"
            disabled={posting}
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
              <Icono className={cn("w-7 h-7", slide.colorText)} />
            </div>
            <div className="flex-1 pr-8">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-1">
                Paso {slideIdx + 1} de {SLIDES.length}
              </div>
              <h2
                id="onboarding-title"
                className={cn("text-2xl font-bold leading-tight", slide.colorText)}
              >
                {slide.titulo}
              </h2>
            </div>
          </div>
        </div>

        {/* Cuerpo del slide */}
        <div className="px-8 py-6 flex-1 overflow-y-auto">
          <p className="text-[15px] text-slate-700 leading-relaxed">
            {slide.descripcion}
          </p>
          <ul className="mt-5 space-y-2">
            {slide.bullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2.5 text-sm text-slate-700"
              >
                <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <Check className="w-2.5 h-2.5 text-emerald-700" strokeWidth={3} />
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {slide.ctaHref && slide.ctaLabel && (
            <Link
              href={slide.ctaHref as never}
              onClick={() => void marcarOnboarded()}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              {slide.ctaLabel}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {/* Footer: navegacion */}
        <div className="px-8 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
          {/* dots de progreso */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSlideIdx(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === slideIdx
                    ? "w-6 bg-brand-600"
                    : i < slideIdx
                    ? "w-1.5 bg-brand-400"
                    : "w-1.5 bg-slate-300",
                )}
                aria-label={`Ir al paso ${i + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {slideIdx > 0 && (
              <button
                type="button"
                onClick={anterior}
                disabled={posting}
                className="h-9 px-3 text-[13px] font-medium text-slate-600 hover:text-slate-900"
              >
                Anterior
              </button>
            )}
            <button
              type="button"
              onClick={marcarOnboarded}
              disabled={posting}
              className="h-9 px-3 text-[13px] font-medium text-slate-500 hover:text-slate-800"
            >
              Saltar
            </button>
            <button
              type="button"
              onClick={siguiente}
              disabled={posting}
              className="h-9 px-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md transition disabled:opacity-60"
            >
              {esUltimo ? "Empezar" : "Siguiente"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
