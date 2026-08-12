import type { Metadata } from "next";
import { FileText, Download, Copy, Sparkles } from "lucide-react";

import { Container, Section } from "@/components/ui";
import { DemoHeader } from "../_shared/demo-header";
import { DemoCTA } from "../_shared/demo-cta";

export const metadata: Metadata = {
  title: "Demo — Publicaciones AI · Aibenchef",
  description:
    "Vista pública del módulo Publicaciones: artículos long-form con gráficos SVG embebidos generados por AI a partir de data real SBS.",
};

// =============================================================================
// Data hardcoded para el chart de mora del sector microfinanciero
// =============================================================================
const barras = [
  { n: "CMAC Cusco", v: 6.38, c: "#10B981" },
  { n: "CMAC Huancayo", v: 7.60, c: "#8B5CF6" },
  { n: "CMAC Arequipa", v: 9.91, c: "#0F2A5E", destacada: true },
  { n: "CMAC Maynas", v: 12.98, c: "#F59E0B" },
  { n: "CMAC Del Santa", v: 19.23, c: "#EF4444" },
  { n: "CMAC Piura", v: 25.87, c: "#DC2626" },
];
const maxV = 28;

// SVG bar chart (mismo estilo que la app real)
function MoraChartSvg() {
  const W = 640;
  const H = 300;
  const padLeft = 130;
  const padRight = 60;
  const padTop = 40;
  const padBottom = 40;
  const barH = 26;
  const gap = ((H - padTop - padBottom) - barH * barras.length) / (barras.length + 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Ranking de mora del sector microfinanciero Jun 2026">
      {/* Ejes verticales de referencia */}
      {[0, 5, 10, 15, 20, 25].map((t) => {
        const x = padLeft + (t / maxV) * (W - padLeft - padRight);
        return (
          <g key={t}>
            <line x1={x} y1={padTop} x2={x} y2={H - padBottom} stroke="#e2e8f0" strokeWidth="1" />
            <text x={x} y={H - padBottom + 16} fontSize="10" fill="#64748b" textAnchor="middle">
              {t}%
            </text>
          </g>
        );
      })}
      {/* Titulo */}
      <text x={padLeft} y={22} fontSize="12" fontWeight="700" fill="#0f172a">
        Mora del sistema microfinanciero — Jun 2026
      </text>
      {/* Barras */}
      {barras.map((b, i) => {
        const y = padTop + gap * (i + 1) + barH * i;
        const w = (b.v / maxV) * (W - padLeft - padRight);
        return (
          <g key={b.n}>
            {/* Label entidad izquierda */}
            <text
              x={padLeft - 8}
              y={y + barH / 2 + 4}
              fontSize={b.destacada ? "12" : "11"}
              fontWeight={b.destacada ? "700" : "400"}
              fill={b.destacada ? "#0f172a" : "#334155"}
              textAnchor="end"
            >
              {b.n}
            </text>
            {/* Barra */}
            <rect x={padLeft} y={y} width={w} height={barH} fill={b.c} rx="2" />
            {/* Valor final */}
            <text
              x={padLeft + w + 6}
              y={y + barH / 2 + 4}
              fontSize="11"
              fontWeight={b.destacada ? "700" : "500"}
              fill={b.c}
            >
              {b.v.toFixed(2)}%
            </text>
          </g>
        );
      })}
      {/* Fuente */}
      <text x={padLeft} y={H - 8} fontSize="9" fill="#94a3b8" fontStyle="italic">
        Fuente: SBS Perú · Corte Jun-26
      </text>
    </svg>
  );
}

// =============================================================================
// Page
// =============================================================================
export default function DemoPublicacionesPage() {
  return (
    <>
      <DemoHeader
        icon={FileText}
        tag="Publicaciones · Artículos con gráficos AI"
        titulo="Análisis long-form listos para LinkedIn"
        descripcion="Artículos editoriales long-form generados con AI desde tu data real. Cada uno incluye 1-2 gráficos SVG embebidos, tono periodístico financiero peruano, cifras exactas y hashtags optimizados."
        chips={[
          { label: "Tema", value: "Mora visual", fijo: true },
          { label: "Entidad propia", value: "CMAC Arequipa", fijo: true },
          { label: "Peer group", value: "5 cajas municipales", fijo: true },
          { label: "Cierre", value: "Jun 2026", fijo: true },
        ]}
      />

      <Section>
        <Container size="md">
          {/* Editor UI mock — barra de acciones */}
          <div className="rounded-t-2xl bg-slate-900 text-white px-5 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-brand-300" />
              <span className="uppercase tracking-wider font-semibold">Vista previa · Artículo generado</span>
              <span className="text-slate-400">·</span>
              <span className="px-2 py-0.5 bg-slate-800 rounded text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
                Borrador
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] bg-slate-800 rounded text-slate-300 border border-slate-700 cursor-not-allowed"
                title="Requiere cuenta"
              >
                <Copy className="w-3 h-3" />
                Copiar para LinkedIn
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] bg-slate-800 rounded text-slate-300 border border-slate-700 cursor-not-allowed"
                title="Requiere cuenta"
              >
                <Download className="w-3 h-3" />
                Descargar HTML
              </button>
            </div>
          </div>

          {/* Articulo editorial long-form */}
          <article className="bg-white ring-1 ring-slate-200 rounded-b-2xl p-8 md:p-12 shadow-lg">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
              CMAC Arequipa · Cierre Jun 2026
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 leading-tight mb-6" style={{ fontFamily: "Georgia, serif" }}>
              La mora del sistema microfinanciero al cierre Jun-26: CMAC Cusco contiene mientras Piura acumula deterioro histórico
            </h1>

            <div className="space-y-5 text-[16px] leading-[1.7] text-slate-800" style={{ fontFamily: "Georgia, serif" }}>
              <p>
                Al cierre de <strong>junio 2026</strong>, la mora global del sistema microfinanciero peruano
                muestra una brecha de <strong>19.5 puntos porcentuales</strong> entre la caja mejor posicionada
                y la más rezagada. <strong>CMAC Cusco</strong> lidera la cartera más limpia del grupo con 6.38%,
                mientras <strong>CMAC Piura</strong> cierra la lista con 25.87% — un ratio que refleja años de
                deterioro acumulado ahora finalmente reconocido vía castigos masivos.
              </p>

              {/* Chart embebido */}
              <figure className="my-8 -mx-4 md:-mx-8">
                <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
                  <MoraChartSvg />
                </div>
                <figcaption className="mt-2 text-center text-[12px] italic text-slate-500">
                  Ranking de mora global (Atrasada + Refinanciada + Castigos 12m) / Cartera Bruta · CMAC Arequipa destacada
                </figcaption>
              </figure>

              <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
                📊 Lectura del ranking
              </h2>
              <p>
                La trayectoria de <strong>CMAC Arequipa</strong> muestra estabilidad en el rango medio: su ratio de
                9.91% se ubica cerca de la mediana del grupo, ni entre las mejores como Cusco (6.38%) ni entre las
                más comprometidas como Del Santa (19.23%) o Piura (25.87%). En 12 meses, Arequipa mantuvo su mora
                dentro de un rango de ±40 puntos base — comportamiento contenido, sin sobresaltos.
              </p>
              <p>
                La caída relevante viene de <strong>CMAC Piura</strong>: en diciembre 2025 sus castigos acumulados 12m
                saltaron de 164 MM a 999 MM en un solo mes (+835 MM, equivalente al 14% de su cartera bruta). Es un
                <em> clean-up</em> extraordinario que blanqueó deterioro histórico. Su mora atrasada actual (6.70%) es
                engañosamente moderada.
              </p>

              <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
                💡 Qué hacer si eres CMAC Arequipa
              </h2>
              <p>
                Tres palancas concretas para mantener la posición mediana y avanzar hacia el cuartil superior:
                <em> primero</em>, endurecer la política de originación en el segmento MYPE mayor a 12 meses;
                <em> segundo</em>, reforzar el equipo de cobranza en las provincias con mayor concentración de mora
                (Arequipa metropolitana explica más del 40% de la cartera atrasada); <em>tercero</em>, provisiones
                anticipatorias sobre operaciones refinanciadas — hoy la cobertura CAR de Arequipa está en 106%,
                versus el 128% de Cusco. Cerrar esa brecha es cuestión de tiempo.
              </p>

              <p className="text-[15px] italic text-slate-600 mt-8 pt-6 border-t border-slate-200">
                ¿Es la mora de Arequipa un margen sostenible frente a la próxima ola de castigos del sistema, o depende
                de una política de riesgo que ya llegó a su límite?
              </p>
            </div>

            {/* Hashtags */}
            <div className="mt-8 pt-6 border-t border-slate-200 flex items-center gap-2 flex-wrap">
              {["#Mora", "#RiesgoCrediticio", "#Microfinanzas", "#SBS", "#SistemaFinancieroPeruano"].map((h) => (
                <span key={h} className="text-[13px] text-brand-700 font-medium">
                  {h}
                </span>
              ))}
            </div>
          </article>
        </Container>
      </Section>

      <DemoCTA
        titulo="Genera este tipo de artículo para tu entidad en 60 segundos"
        features={[
          "6 temas: Mora, Rentabilidad, Benchmarking, Coyuntura, DuPont, Evolución PE",
          "Gráficos SVG embebidos (line + bar charts, no PNG)",
          "Tono editorial peruano · 400-800 palabras",
          "Hashtags optimizados para LinkedIn",
          "Copiar como texto plano o descargar HTML autocontenido",
          "Cada chart descargable como PNG 1200×675 para subir a LinkedIn",
        ]}
      />
    </>
  );
}
