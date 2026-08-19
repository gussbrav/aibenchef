/**
 * Seccion "Explora los modulos" — 4 tarjetas grandes, una por modulo
 * principal del producto. Cada mockup esta rediseñado con densidad
 * analitica de "senior financiero" — no data flat, sino:
 *   - Contexto arriba (segmento / periodo / peer group)
 *   - Ranking + delta YoY (mejora/deterioro periodo previo)
 *   - Driver principal (que componente explica el numero)
 *   - Read editorial abajo (conclusion 1-linea)
 *
 * Los mockups usan cifras reales publicas del regulador peruano al cierre
 * Jun 2026, aproximadas para fines demostrativos del landing.
 */

import Link from "next/link";
import { ArrowUpRight, TrendingUp, BarChart3, GitBranch, FileText } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui";

// =============================================================================
// Mini-mockup 1: Cuadro Resumen — vista de analista senior
// Denso, agrupado por seccion, con delta YoY y ranking chip por metrica.
// =============================================================================
function InformeMockup() {
  // Data agrupada por seccion — asi lee un analista real, no metricas sueltas
  const secciones = [
    {
      label: "Calidad de cartera",
      rows: [
        { m: "% Mora Global", vals: [5.55, 6.42, 7.83, 9.43], delta: -0.34, ranking: "1° de 4", better: "lower" as const },
        { m: "% Créd. Atrasados", vals: [2.73, 3.51, 4.21, 4.87], delta: -0.18, ranking: "1° de 4", better: "lower" as const },
        { m: "Cob. CAR (%)", vals: [127.9, 118.4, 108.2, 101.1], delta: 4.2, ranking: "1° de 4", better: "higher" as const },
      ],
    },
    {
      label: "Rentabilidad",
      rows: [
        { m: "% ROE (TTM)", vals: [27.18, 22.44, 18.90, 15.79], delta: 1.6, ranking: "1° de 4", better: "higher" as const },
        { m: "% ROA (TTM)", vals: [3.44, 2.81, 2.11, 2.35], delta: 0.2, ranking: "1° de 4", better: "higher" as const },
      ],
    },
  ];
  const tierCls = (rank: number, better: "lower" | "higher") => {
    // rank 0..3, 0 es el propio (BCP) — pintamos con brand color
    // El resto va por posicion en el ranking del sector
    const good = better === "lower" ? rank <= 1 : rank <= 1;
    if (rank === 0) return "bg-brand-50 text-brand-900 font-semibold";
    if (good) return "bg-emerald-50 text-emerald-800";
    return "bg-rose-50/70 text-rose-800";
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[10px]">
      {/* Header con contexto profesional */}
      <div className="px-3 py-2 bg-slate-900 text-white">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-wider uppercase text-[9px]">Cuadro Resumen · Banca Múltiple</span>
          <span className="text-[8.5px] text-slate-300 tabular-nums">Cierre Jun-26</span>
        </div>
        <div className="text-[8.5px] text-slate-400 mt-0.5">
          BCP vs peer group (top-3 por cartera bruta)
        </div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-slate-500 border-b border-slate-100 text-[8.5px]">
            <th className="text-left px-2 py-1.5 font-medium uppercase w-[38%]">Métrica</th>
            <th className="text-right px-1.5 py-1.5 font-bold text-brand-700 uppercase">BCP</th>
            <th className="text-right px-1.5 py-1.5 font-medium">BBVA</th>
            <th className="text-right px-1.5 py-1.5 font-medium">IBK</th>
            <th className="text-right px-1.5 py-1.5 font-medium">Pich</th>
          </tr>
        </thead>
        <tbody>
          {secciones.map((s) => (
            <>
              <tr key={`sec-${s.label}`} className="bg-slate-50/60">
                <td colSpan={5} className="px-2 py-0.5 text-[8.5px] uppercase tracking-wider text-slate-500 font-semibold">
                  {s.label}
                </td>
              </tr>
              {s.rows.map((r) => {
                const isPositive = r.better === "higher" ? r.delta > 0 : r.delta < 0;
                return (
                  <tr key={r.m} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-700 text-[9.5px]">
                      <div className="flex items-center gap-1">
                        <span>{r.m}</span>
                        <span className={`text-[8px] tabular-nums font-semibold ${isPositive ? "text-emerald-600" : "text-rose-500"}`}>
                          {r.delta > 0 ? "▲" : "▼"}{Math.abs(r.delta).toFixed(1)}pp
                        </span>
                      </div>
                    </td>
                    {r.vals.map((v, i) => (
                      <td key={i} className={`px-1.5 py-1 text-right tabular-nums text-[9.5px] ${tierCls(i, r.better)}`}>
                        {v.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </>
          ))}
        </tbody>
      </table>
      {/* Read editorial estilo analista */}
      <div className="px-2.5 py-1.5 bg-slate-50/70 border-t border-slate-100">
        <p className="text-[9px] text-slate-700 leading-snug">
          <span className="font-bold text-brand-700">Lectura:</span> BCP lidera en calidad y rentabilidad,
          con mejora YoY en todas las métricas de mora. Cobertura CAR &gt;127% da colchón vs pares.
        </p>
      </div>
      <div className="px-2.5 py-1 border-t border-slate-100 bg-white text-[8px] text-slate-400 italic flex justify-between">
        <span>Fuente: publicaciones oficiales del regulador</span>
        <span>▲/▼ vs Jun-25</span>
      </div>
    </div>
  );
}

// =============================================================================
// Mini-mockup 2: DuPont — descomposicion con driver principal identificado
// El analista senior ve INMEDIATO cual es el motor del ROE (eficiencia
// operativa via ROA vs apalancamiento via multiplicador de capital).
// =============================================================================
function DupontMockup() {
  const entidades = [
    { nombre: "Compartamos", roe: 27.5, roa: 5.9, apal: 4.6, driver: "eficiencia" as const, color: "#0F2A5E" },
    { nombre: "Huancayo",    roe: 29.9, roa: 3.5, apal: 8.5, driver: "leverage" as const, color: "#F59E0B" },
    { nombre: "Mibanco",     roe: 25.3, roa: 3.7, apal: 6.8, driver: "balance" as const, color: "#8B5CF6" },
    { nombre: "Arequipa",    roe: 20.6, roa: 1.9, apal: 10.7, driver: "leverage" as const, color: "#10B981" },
  ];
  const maxRoe = 32;
  const driverStyle: Record<"eficiencia" | "leverage" | "balance", { label: string; cls: string }> = {
    eficiencia: { label: "ROA alto", cls: "bg-emerald-100 text-emerald-800" },
    leverage:   { label: "Apalancado", cls: "bg-amber-100 text-amber-800" },
    balance:    { label: "Balanceado", cls: "bg-slate-100 text-slate-700" },
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[10px]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-100 bg-white flex items-center justify-between">
        <div>
          <div className="font-semibold text-slate-900 text-[11px]">DuPont · Microfinanzas</div>
          <div className="text-[8.5px] text-slate-500">ROE = ROA × Apalancamiento · TTM Jun-26</div>
        </div>
        <span className="text-[8.5px] text-slate-500 tabular-nums">4 entidades</span>
      </div>

      {/* Column headers */}
      <div className="px-3 pt-2 pb-1 grid grid-cols-[70px_1fr_44px_44px_60px] gap-1.5 text-[8px] uppercase tracking-wider text-slate-500 font-medium">
        <span>Entidad</span>
        <span>ROE (%)</span>
        <span className="text-right">ROA</span>
        <span className="text-right">Apal.</span>
        <span className="text-center">Driver</span>
      </div>

      {/* Bars */}
      <div className="px-3 pb-2 space-y-1.5">
        {entidades.map((e) => (
          <div key={e.nombre} className="grid grid-cols-[70px_1fr_44px_44px_60px] gap-1.5 items-center">
            <span className="text-slate-800 text-[9.5px] font-medium truncate">{e.nombre}</span>
            <div className="h-4 bg-slate-50 rounded-sm relative overflow-hidden">
              <div
                className="h-full rounded-sm transition-all"
                style={{ width: `${(e.roe / maxRoe) * 100}%`, backgroundColor: e.color }}
              />
              <span className="absolute inset-0 flex items-center pl-1.5 text-[9px] font-semibold text-white mix-blend-difference">
                {e.roe.toFixed(1)}%
              </span>
            </div>
            <span className="text-[9px] text-slate-700 text-right tabular-nums font-medium">
              {e.roa.toFixed(1)}%
            </span>
            <span className="text-[9px] text-slate-700 text-right tabular-nums font-medium">
              {e.apal.toFixed(1)}×
            </span>
            <span className={`text-[8.5px] text-center px-1 py-0.5 rounded font-semibold ${driverStyle[e.driver].cls}`}>
              {driverStyle[e.driver].label}
            </span>
          </div>
        ))}
      </div>

      {/* Read editorial */}
      <div className="px-3 py-1.5 bg-slate-50/70 border-t border-slate-100">
        <p className="text-[9px] text-slate-700 leading-snug">
          <span className="font-bold text-brand-700">Insight:</span> Huancayo lidera el ROE
          pero por <span className="font-semibold">apalancamiento 8.5×</span>, no eficiencia.
          Compartamos convierte activos mejor (ROA 5.9%) con balance más conservador.
        </p>
      </div>
      <div className="px-2.5 py-1 border-t border-slate-100 text-[8px] text-slate-400 italic">
        Fuente: publicaciones oficiales del regulador
      </div>
    </div>
  );
}

// =============================================================================
// Mini-mockup 3: Punto de Equilibrio — con banda de peers + anotacion
// El analista senior no solo mira la linea propia, mira DONDE cae en la
// distribucion (banda percentil 25-75 del sector).
// =============================================================================
function PuntoEquilibrioMockup() {
  const puntos = [
    { p: "Dic-21", propio: 9.63, p25: 7.8, p75: 9.2 },
    { p: "Dic-22", propio: 7.25, p25: 7.4, p75: 8.9 },
    { p: "Dic-23", propio: 9.30, p25: 8.1, p75: 9.4 },
    { p: "Dic-24", propio: 9.83, p25: 8.3, p75: 9.6 },
    { p: "Dic-25", propio: 9.60, p25: 8.5, p75: 9.8 },
    { p: "Jun-26", propio: 9.63, p25: 8.4, p75: 9.7 },
  ];
  const W = 260;
  const H = 100;
  const minY = 6.5;
  const maxY = 11;
  const scaleX = (i: number) => (i / (puntos.length - 1)) * (W - 40) + 30;
  const scaleY = (v: number) => H - 20 - ((v - minY) / (maxY - minY)) * (H - 35);
  const pathPropio = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i)},${scaleY(p.propio)}`).join(" ");
  // Banda como polygon: sube p75 y baja p25 en reverso
  const bandPath =
    puntos.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i)},${scaleY(p.p75)}`).join(" ") +
    " " +
    puntos.slice().reverse().map((p, i) => `L${scaleX(puntos.length - 1 - i)},${scaleY(p.p25)}`).join(" ") +
    " Z";

  const ultimoPropio = puntos[puntos.length - 1]!.propio;
  const ultimoMediana = (puntos[puntos.length - 1]!.p25 + puntos[puntos.length - 1]!.p75) / 2;
  const spread = (ultimoPropio - ultimoMediana).toFixed(2);

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[10px]">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="font-semibold text-slate-900 text-[11px]">Punto de Equilibrio · BCP</div>
          <div className="text-[8.5px] text-slate-500">% cartera necesario · 5 cierres anuales</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">Actual</div>
          <div className="text-[13px] font-bold text-brand-700 tabular-nums leading-none">
            {ultimoPropio.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="px-2 py-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Punto de equilibrio con banda de peers">
          {/* Grid horizontal */}
          {[7, 8, 9, 10, 11].map((g) => (
            <g key={g}>
              <line x1={30} y1={scaleY(g)} x2={W - 10} y2={scaleY(g)} stroke="#e2e8f0" strokeWidth="0.5" />
              <text x={26} y={scaleY(g) + 2.5} fontSize="7" fill="#94a3b8" textAnchor="end">{g}%</text>
            </g>
          ))}

          {/* Banda percentil 25-75 (sector) */}
          <path d={bandPath} fill="#94a3b8" fillOpacity="0.18" stroke="none" />

          {/* Linea propia destacada */}
          <path d={pathPropio} fill="none" stroke="#0F2A5E" strokeWidth="2.2" />

          {/* Puntos */}
          {puntos.map((p, i) => (
            <circle key={i} cx={scaleX(i)} cy={scaleY(p.propio)} r="2.3" fill="#0F2A5E" stroke="white" strokeWidth="1" />
          ))}

          {/* Anotacion caida 2022 */}
          <g>
            <circle cx={scaleX(1)} cy={scaleY(7.25)} r="4" fill="none" stroke="#dc2626" strokeWidth="0.8" />
            <text x={scaleX(1) + 6} y={scaleY(7.25) + 2.5} fontSize="7" fill="#dc2626" fontWeight="600">
              Compresión margen
            </text>
          </g>

          {/* Label ultimo punto */}
          <text
            x={scaleX(puntos.length - 1) - 2}
            y={scaleY(ultimoPropio) - 4}
            fontSize="8.5"
            fill="#0F2A5E"
            fontWeight="700"
            textAnchor="end"
          >
            {ultimoPropio.toFixed(2)}%
          </text>

          {/* X axis labels */}
          {puntos.map((p, i) =>
            i === 0 || i === puntos.length - 1 || i === Math.floor(puntos.length / 2) ? (
              <text
                key={p.p}
                x={scaleX(i)}
                y={H - 6}
                fontSize="7.5"
                fill="#64748b"
                textAnchor="middle"
              >
                {p.p}
              </text>
            ) : null,
          )}
        </svg>

        {/* Leyenda editorial + spread numerico */}
        <div className="flex items-center justify-between mt-1 text-[9px]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-brand-900" /> BCP
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 bg-slate-400/25 border border-slate-300" /> Banda P25–P75
            </span>
          </div>
          <span className="text-slate-600 tabular-nums font-medium">
            Spread: <span className={Number(spread) > 0 ? "text-emerald-700" : "text-rose-700"}>
              {Number(spread) > 0 ? "+" : ""}{spread}pp
            </span> vs mediana
          </span>
        </div>
      </div>

      <div className="px-3 py-1.5 bg-slate-50/70 border-t border-slate-100">
        <p className="text-[9px] text-slate-700 leading-snug">
          <span className="font-bold text-brand-700">Lectura:</span> BCP se recupera post-shock 2022
          y hoy opera <span className="font-semibold">0.15pp arriba del P75</span> — top tier del sector.
        </p>
      </div>
      <div className="px-2.5 py-1 border-t border-slate-100 text-[8px] text-slate-400 italic">
        Fuente: publicaciones oficiales del regulador · Banda = P25–P75 de Banca Múltiple
      </div>
    </div>
  );
}

// =============================================================================
// Mini-mockup 4: Publicaciones — articulo editorial con headline periodistico
// Un analista senior lee el titular + primer parrafo + chart. Si convence,
// baja al detalle. El mockup replica ese jerarquia editorial.
// =============================================================================
function PublicacionesMockup() {
  const barras = [
    { n: "Cusco",     v: 6.4,  grupo: "contiene", c: "#059669" },
    { n: "Huancayo",  v: 7.6,  grupo: "contiene", c: "#059669" },
    { n: "Arequipa",  v: 9.9,  grupo: "mediana",  c: "#0F2A5E", destacada: true },
    { n: "Maynas",    v: 13.0, grupo: "deterioro",c: "#f59e0b" },
    { n: "Del Santa", v: 19.2, grupo: "deterioro",c: "#dc2626" },
    { n: "Piura",     v: 25.9, grupo: "deterioro",c: "#dc2626" },
  ];
  const maxV = 30;

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-[10px]">
      {/* Meta bar estilo prensa */}
      <div className="px-3 py-1.5 border-b border-slate-100 bg-white flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] uppercase tracking-wider font-bold text-brand-700">Análisis · Riesgo</span>
          <span className="text-[8px] text-slate-400">·</span>
          <span className="text-[8px] text-slate-500">3 min de lectura</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded font-semibold border border-amber-200">
          <span className="w-1 h-1 rounded-full bg-amber-500" />
          Draft AI
        </span>
      </div>

      {/* Headline editorial */}
      <div className="px-3 pt-2 pb-1.5">
        <h4 className="font-bold text-slate-900 text-[13px] leading-tight tracking-tight">
          Las CMAC se dividen en dos:<br />contención al norte, deterioro al sur
        </h4>
        <p className="text-[9.5px] text-slate-600 italic mt-1 leading-snug">
          Al cierre Jun-26, la brecha de mora entre la mejor y peor caja municipal
          alcanza <span className="font-semibold text-slate-800">19.5 pp</span> — máximo
          histórico de 5 años.
        </p>
      </div>

      {/* Chart embebido */}
      <div className="px-3 pt-1 pb-2">
        <div className="text-[8px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
          Mora global · CMAC seleccionadas
        </div>
        <div className="space-y-1">
          {barras.map((b) => (
            <div key={b.n} className="flex items-center gap-1.5">
              <span className={`text-[9px] w-14 truncate ${b.destacada ? "font-bold text-slate-900" : "text-slate-600"}`}>
                {b.n}
              </span>
              <div className="flex-1 h-2.5 bg-slate-50 rounded-sm overflow-hidden relative">
                <div className="h-full rounded-sm" style={{ width: `${(b.v / maxV) * 100}%`, backgroundColor: b.c }} />
              </div>
              <span className="text-[9px] tabular-nums w-9 text-right text-slate-700 font-medium">
                {b.v.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
        {/* Escala */}
        <div className="flex justify-between text-[7.5px] text-slate-400 mt-1 pl-[62px] pr-11">
          <span>0%</span><span>15%</span><span>30%</span>
        </div>
      </div>

      {/* Pull-quote / conclusion editorial */}
      <div className="px-3 py-1.5 bg-slate-50/70 border-t border-l-2 border-l-brand-500 border-slate-100">
        <p className="text-[9px] text-slate-700 leading-snug italic">
          "El deterioro en Del Santa y Piura acumula <span className="font-semibold not-italic text-brand-800">3+ años</span> de
          castigos altos — no es shock coyuntural, es estructural."
        </p>
      </div>

      <div className="px-2.5 py-1 border-t border-slate-100 text-[8px] flex justify-between items-center bg-white">
        <span className="text-slate-400 italic">Gráfico SVG · publicaciones oficiales</span>
        <span className="text-slate-500 tabular-nums">#Riesgo #Microfinanzas</span>
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
      "Cuadro resumen agrupado por sección — con delta YoY, ranking y lectura editorial. La foto que el gerente pide antes del Comité.",
    features: ["Peer group configurable", "Delta YoY por métrica", "Lectura ejecutiva AI"],
    Mockup: InformeMockup,
    href: "/demo/informe",
  },
  {
    icon: GitBranch,
    tag: "DuPont",
    title: "Rentabilidad descompuesta",
    description:
      "ROE = ROA × Apalancamiento con driver identificado por entidad: quién gana por eficiencia y quién por leverage.",
    features: ["Driver por entidad", "Insight editorial AI", "Comparativo multi-entidad"],
    Mockup: DupontMockup,
    href: "/demo/dupont",
  },
  {
    icon: TrendingUp,
    tag: "Punto de Equilibrio",
    title: "Rendimiento mínimo",
    description:
      "El % de cartera que necesitas para cubrir fondeo + provisiones + gastos. Con banda P25–P75 del sector y spread vs mediana.",
    features: ["Serie histórica anual", "Banda de percentiles", "Spread vs mediana"],
    Mockup: PuntoEquilibrioMockup,
    href: "/demo/punto-equilibrio",
  },
  {
    icon: FileText,
    tag: "Publicaciones",
    title: "Artículos con gráficos AI",
    description:
      "Análisis editorial long-form con headline periodístico, chart embebido y pull-quote — listo para publicar en LinkedIn.",
    features: ["Headline editorial", "Chart SVG + pull-quote", "Descarga HTML + PNG"],
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
