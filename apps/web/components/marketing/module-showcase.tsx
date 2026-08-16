/**
 * Seccion "Explora los modulos" — 4 tarjetas grandes, una por modulo
 * principal del producto. Cada tarjeta tiene:
 *   - Titulo + descripcion (1 linea)
 *   - Mini-mockup visual del modulo (SVG/HTML puro, cero PNG)
 *   - Chips de features clave
 *   - CTA "Ver demo interactiva" (Sprint 2)
 *
 * Los mockups usan data publica SBS Jun 2026. Se ven identicos al
 * producto real porque comparten paleta brand + tipografia + iconografia.
 */

import Link from "next/link";
import { ArrowUpRight, TrendingUp, BarChart3, GitBranch, FileText } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui";

// =============================================================================
// Mini-mockup 1: Informe / Benchmark — mini-tabla con heatmap
// =============================================================================
function InformeMockup() {
  const rows = [
    { label: "% Mora", vals: [2.73, 3.51, 4.21, 4.87], tiers: ["top", "high", "low", "bottom"] },
    { label: "% ROE", vals: [27.18, 22.44, 18.90, 15.79], tiers: ["top", "high", "low", "bottom"] },
    { label: "Cob. CAR", vals: [127.9, 118.4, 108.2, 101.1], tiers: ["top", "high", "low", "bottom"] },
  ] as const;
  const tierCls: Record<string, string> = {
    top: "bg-emerald-50 text-emerald-900",
    high: "bg-emerald-50/60 text-emerald-700",
    low: "bg-amber-50/60 text-amber-800",
    bottom: "bg-rose-50 text-rose-900",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[10.5px]">
      <div className="px-2.5 py-1.5 bg-slate-900 text-white flex items-center justify-between">
        <span className="font-semibold tracking-wider uppercase text-[9px]">Cuadro Resumen</span>
        <span className="text-[9px] text-slate-300">Jun-26</span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-slate-500 border-b border-slate-100">
            <th className="text-left px-2 py-1 font-medium text-[9px] uppercase">Métrica</th>
            <th className="text-right px-1.5 py-1 font-semibold text-brand-700">BCP</th>
            <th className="text-right px-1.5 py-1 font-medium">BBVA</th>
            <th className="text-right px-1.5 py-1 font-medium">Interbank</th>
            <th className="text-right px-1.5 py-1 font-medium">Pichincha</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-700">{r.label}</td>
              {r.vals.map((v, i) => (
                <td key={i} className={`px-1.5 py-1 text-right tabular-nums ${i === 0 ? "bg-brand-50 text-brand-900 font-semibold" : tierCls[r.tiers[i]!]}`}>
                  {v.toFixed(2)}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 border-t border-slate-100 bg-slate-50/50 text-[8.5px] text-slate-500 italic">
        Fuente: pública oficial
      </div>
    </div>
  );
}

// =============================================================================
// Mini-mockup 2: DuPont — barra ROE + ROA + Apalancamiento
// =============================================================================
function DupontMockup() {
  const entidades = [
    { nombre: "Compartamos", roe: 27.47, roa: 5.93, apal: 4.63, color: "#0F2A5E" },
    { nombre: "Huancayo", roe: 29.89, roa: 3.50, apal: 8.53, color: "#F59E0B" },
    { nombre: "Mibanco", roe: 25.27, roa: 3.72, apal: 6.80, color: "#8B5CF6" },
    { nombre: "Arequipa", roe: 20.55, roa: 1.93, apal: 10.67, color: "#10B981" },
  ];
  const maxRoe = 32;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-[10px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-900 text-[11px]">Descomposición ROE</span>
        <span className="text-slate-500 text-[9px]">TTM Jun-26</span>
      </div>
      <div className="space-y-1.5">
        {entidades.map((e) => (
          <div key={e.nombre} className="flex items-center gap-2">
            <span className="text-slate-700 text-[10px] w-16 truncate">{e.nombre}</span>
            <div className="flex-1 h-4 bg-slate-100 rounded relative overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${(e.roe / maxRoe) * 100}%`, backgroundColor: e.color }}
              />
              <span className="absolute inset-0 flex items-center justify-end pr-1.5 text-[9px] font-semibold text-slate-900">
                {e.roe.toFixed(1)}%
              </span>
            </div>
            <span className="text-[9px] text-slate-500 w-14 text-right tabular-nums">
              ROA {e.roa.toFixed(1)}% × {e.apal.toFixed(1)}×
            </span>
          </div>
        ))}
      </div>
      <p className="text-[8.5px] text-slate-500 italic pt-1 border-t border-slate-100">
        Fuente: pública oficial
      </p>
    </div>
  );
}

// =============================================================================
// Mini-mockup 3: Punto de Equilibrio — line chart SVG simple
// =============================================================================
function PuntoEquilibrioMockup() {
  const puntos = [
    { p: "Dic-21", propio: 9.63, promedio: 8.5 },
    { p: "Dic-22", propio: 7.25, promedio: 8.0 },
    { p: "Dic-23", propio: 9.30, promedio: 8.8 },
    { p: "Dic-24", propio: 9.83, promedio: 9.2 },
    { p: "Dic-25", propio: 9.60, promedio: 9.5 },
    { p: "Jun-26", propio: 9.63, promedio: 9.4 },
  ];
  const W = 220;
  const H = 90;
  const minY = 6.5;
  const maxY = 11;
  const scaleX = (i: number) => (i / (puntos.length - 1)) * (W - 30) + 20;
  const scaleY = (v: number) => H - 15 - ((v - minY) / (maxY - minY)) * (H - 30);
  const pathPropio = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i)},${scaleY(p.propio)}`).join(" ");
  const pathPromedio = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i)},${scaleY(p.promedio)}`).join(" ");
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1 text-[10px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-900 text-[11px]">Punto de Equilibrio · BCP</span>
        <span className="text-slate-500 text-[9px]">5 cierres</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Line chart PE">
        {/* grid horizontal */}
        {[6.5, 8, 9.5, 11].map((g) => (
          <line key={g} x1={20} y1={scaleY(g)} x2={W - 10} y2={scaleY(g)} stroke="#e2e8f0" strokeWidth="0.5" />
        ))}
        {/* linea promedio (comparable) */}
        <path d={pathPromedio} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3,2" />
        {/* linea propia destacada */}
        <path d={pathPropio} fill="none" stroke="#0F2A5E" strokeWidth="2.5" />
        {puntos.map((p, i) => (
          <circle key={i} cx={scaleX(i)} cy={scaleY(p.propio)} r="2.5" fill="#0F2A5E" stroke="white" strokeWidth="1" />
        ))}
        {/* label ultimo punto */}
        <text x={scaleX(puntos.length - 1) + 4} y={scaleY(puntos[puntos.length - 1]!.propio) + 3} fontSize="8" fill="#0F2A5E" fontWeight="600">
          9.63%
        </text>
      </svg>
      <div className="flex items-center gap-3 text-[9px]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-brand-900" /> BCP
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 border-t border-dashed border-slate-400" /> Promedio Bancos
        </span>
      </div>
      <p className="text-[8.5px] text-slate-500 italic pt-1 border-t border-slate-100">
        Fuente: pública oficial
      </p>
    </div>
  );
}

// =============================================================================
// Mini-mockup 4: Publicaciones — articulo generado con chart embebido
// =============================================================================
function PublicacionesMockup() {
  // Bar chart horizontal mora del sector
  const barras = [
    { n: "Cusco", v: 6.38, c: "#10B981" },
    { n: "Huancayo", v: 7.60, c: "#8B5CF6" },
    { n: "Arequipa", v: 9.91, c: "#0F2A5E", destacada: true },
    { n: "Maynas", v: 12.98, c: "#F59E0B" },
    { n: "Del Santa", v: 19.23, c: "#EF4444" },
    { n: "Piura", v: 25.87, c: "#DC2626" },
  ];
  const maxV = 30;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5 text-[10px]">
      <p className="font-bold text-slate-900 text-[11px] leading-tight">
        Mora del sistema microfinanciero Jun-26
      </p>
      <p className="text-[9px] text-slate-500 italic leading-snug">
        CMAC Cusco contiene mientras Piura acumula deterioro histórico vía castigos...
      </p>
      <div className="mt-1.5 space-y-1">
        {barras.map((b) => (
          <div key={b.n} className="flex items-center gap-1.5">
            <span className={`text-[9px] w-14 truncate ${b.destacada ? "font-bold text-brand-900" : "text-slate-600"}`}>
              {b.n}
            </span>
            <div className="flex-1 h-3 bg-slate-50 rounded-sm overflow-hidden">
              <div className="h-full rounded-sm" style={{ width: `${(b.v / maxV) * 100}%`, backgroundColor: b.c }} />
            </div>
            <span className="text-[9px] tabular-nums w-9 text-right text-slate-700 font-medium">
              {b.v.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <div className="pt-1 border-t border-slate-100 text-[9px] flex items-center justify-between">
        <span className="text-slate-500 italic">Chart SVG · Fuente pública oficial</span>
        <span className="text-slate-400">#RiesgoCrediticio #Banca</span>
      </div>
    </div>
  );
}

// =============================================================================
// Grid de 4 tarjetas
// =============================================================================
const modulos = [
  {
    icon: BarChart3,
    tag: "Informe",
    title: "Benchmark ejecutivo",
    description:
      "Cuadro resumen con heatmap: dónde lidera tu entidad y dónde queda rezagada vs el peer group.",
    features: ["Peer group configurable", "Heatmap por métrica", "Export PDF"],
    Mockup: InformeMockup,
    href: "/demo/informe",
  },
  {
    icon: GitBranch,
    tag: "DuPont",
    title: "Rentabilidad descompuesta",
    description:
      "Árbol ROE = ROA × Apalancamiento con lectura AI: quién gana por eficiencia vs por leverage.",
    features: ["4 niveles del árbol", "Lectura editorial AI", "Comparativo multi-entidad"],
    Mockup: DupontMockup,
    href: "/demo/dupont",
  },
  {
    icon: TrendingUp,
    tag: "Punto de Equilibrio",
    title: "Rendimiento mínimo",
    description:
      "El % de cartera que necesitas para cubrir fondeo + provisiones + gastos operacionales.",
    features: ["Serie histórica", "Banda de peers", "Comparativo mensual/anual"],
    Mockup: PuntoEquilibrioMockup,
    href: "/demo/punto-equilibrio",
  },
  {
    icon: FileText,
    tag: "Publicaciones",
    title: "Artículos con gráficos AI",
    description:
      "Genera análisis editorial long-form con gráficos SVG embebidos, listo para LinkedIn.",
    features: ["6 temas editoriales", "Gráficos SVG embebidos", "Descarga HTML + PNG"],
    Mockup: PublicacionesMockup,
    href: "/demo/publicaciones",
  },
];

export function ModuleShowcase() {
  return (
    <Section id="modulos">
      <Container size="xl">
        <SectionHeading
          eyebrow="Explora los módulos"
          title="Cuatro herramientas, un solo cierre"
          description="Todos los módulos comparten la misma fuente oficial, peer group y período. Cambias el cierre en un lugar y todo se actualiza."
        />
        <div className="mt-16 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {modulos.map(({ icon: Icon, tag, title, description, features, Mockup, href }) => (
            <div
              key={title}
              className="group relative flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 hover:ring-slate-300 transition-all hover:shadow-xl hover:shadow-slate-900/5"
            >
              {/* Header */}
              <div className="px-6 pt-6 pb-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-brand-700">
                    {tag}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-slate-900">{title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
              </div>

              {/* Mini-mockup */}
              <div className="px-6 py-4 bg-gradient-to-b from-slate-50/50 to-slate-100/30">
                <Mockup />
              </div>

              {/* Features + CTA */}
              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {features.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center px-2 py-0.5 text-[10px] text-slate-600 bg-slate-100 rounded"
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <Link
                  href={href as never}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 group/link"
                >
                  Ver demo
                  <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
