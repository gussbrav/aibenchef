"use client";

// Dashboard "Informe Ejecutivo" — replica visual del benchmark Caja
// Arequipa (Junio 2020). Por ahora consume la fixture hardcoded; la
// proxima iteracion conecta a marts.v_punto_equilibrio_ancho.
//
// La estructura sigue las secciones del PDF original:
//   1. Header: cliente + periodo + boton descargar PPT
//   2. Cuadro Resumen (slide 5)
//   3. Punto de Equilibrio Anualizado (slide 6)
//   4. Analisis Margen Neto: bubble + waterfall (slides 7-8)

import { useMemo, useState } from "react";
import { Download, FileText, Info } from "lucide-react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

import type { InformeData, Kpi, KpiValor, PuntoEquilibrioRow } from "./fixture-data";

// ============================================================================
// Helpers de formato y ranking
// ============================================================================

function formatValor(valor: number | null, unidad: Kpi["unidad"]): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  switch (unidad) {
    case "pct":
      return new Intl.NumberFormat("es-PE", {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valor);
    case "numero":
    case "numero_miles":
      return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(valor);
    case "moneda_mm":
      return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(valor);
    case "moneda_miles":
      return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(valor);
    default:
      return String(valor);
  }
}

// Computa rank 1/2/3 entre los valores no-nulos respetando el signo del KPI.
// signo +1 = valor alto es mejor (ROE, cartera); signo -1 = valor alto es peor (mora, costos).
function computeRanks(valores: KpiValor[], signo: 1 | -1): Map<string, number> {
  const ranks = new Map<string, number>();
  const sorted = valores
    .filter((v) => v.valor !== null && v.valor !== undefined)
    .sort((a, b) => {
      const av = a.valor as number;
      const bv = b.valor as number;
      return signo === 1 ? bv - av : av - bv;
    });
  sorted.slice(0, 3).forEach((v, i) => ranks.set(v.competidor, i + 1));
  return ranks;
}

function RankBadge({ rank }: { rank?: number }) {
  if (!rank) return null;
  const colors: Record<number, string> = {
    1: "bg-blue-600 text-white",
    2: "bg-blue-400 text-white",
    3: "bg-blue-200 text-blue-900",
  };
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ml-1 ${colors[rank]}`}
      title={`Ranking ${rank} de 3`}
    >
      {rank}
    </span>
  );
}

// ============================================================================
// Componente principal
// ============================================================================

export function InformeClient({ data }: { data: InformeData }) {
  const { cliente, periodo, competidores, cuadroResumen, puntoEquilibrio, margenNetoBubble, margenNetoWaterfallVsAbr19, comentarios } = data;
  const [exportando, setExportando] = useState(false);

  const onExportPpt = () => {
    setExportando(true);
    // TODO Fase 4: conectar a /api/v1/informe/export?cliente=X&periodo=Y&formato=pptx
    setTimeout(() => {
      alert("Export PPT — feature pendiente (Fase 4 del roadmap). Por ahora ver docs/PRODUCT_VISION.md");
      setExportando(false);
    }, 400);
  };

  return (
    <div className="space-y-10 max-w-7xl mx-auto px-2">
      {/* ============ HEADER ============ */}
      <header
        className="rounded-xl text-white p-8 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${cliente.brand.primary} 0%, ${cliente.brand.acento} 100%)` }}
      >
        <div className="flex items-start justify-between gap-6 flex-wrap relative z-10">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-75 mb-2">Informe Ejecutivo de Benchmark</p>
            <h1 className="text-3xl font-bold mb-1">{cliente.nombre}</h1>
            <p className="text-lg opacity-90">Cierre {periodo.label}</p>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <span className="text-xs uppercase opacity-75">Peer group:</span>
              {competidores.map((c) => (
                <span
                  key={c.nombCorreg}
                  className={`text-[11px] px-2 py-0.5 rounded ${c.esPropio ? "bg-white text-slate-900 font-semibold" : "bg-white/15"}`}
                  style={c.esPropio ? {} : { borderLeft: `3px solid ${c.color}` }}
                >
                  {c.labelCorto}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onExportPpt}
              disabled={exportando}
              className="h-9 px-4 bg-white text-slate-900 hover:bg-slate-100 text-sm font-medium rounded transition-colors inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {exportando ? "Generando..." : "Descargar PPT"}
            </button>
            <button
              type="button"
              onClick={onExportPpt}
              disabled={exportando}
              className="h-9 px-4 bg-white/15 hover:bg-white/25 text-white text-sm font-medium rounded transition-colors inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileText className="w-4 h-4" />
              Descargar PDF
            </button>
          </div>
        </div>
      </header>

      {/* ============ CUADRO RESUMEN ============ */}
      <SeccionCuadroResumen data={cuadroResumen} competidores={competidores.map((c) => c.labelCorto)} clientePropio="Caja Arequipa" />

      {/* ============ PUNTO DE EQUILIBRIO ============ */}
      <SeccionPuntoEquilibrio data={puntoEquilibrio} competidores={competidores.map((c) => c.labelCorto)} clientePropio="Caja Arequipa" />

      {/* ============ ANALISIS MARGEN NETO — BUBBLE ============ */}
      <SeccionMargenNetoBubble
        data={margenNetoBubble}
        competidores={competidores}
        comentario={comentarios.margen_neto_bubble}
      />

      {/* ============ ANALISIS MARGEN NETO — WATERFALL ============ */}
      <SeccionMargenNetoWaterfall
        data={margenNetoWaterfallVsAbr19}
        competidores={competidores}
        comentario={comentarios.margen_neto_waterfall}
      />

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-slate-200 pt-4 pb-8 text-center">
        <p className="text-xs text-slate-500">
          Fuente: SBS · Benchmark generado por Aibenchef · {new Date().toLocaleDateString("es-PE", { dateStyle: "long" })}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          Datos provisionales basados en fixture del PDF de referencia. Conexion a marts.v_punto_equilibrio_ancho pendiente (V034).
        </p>
      </footer>
    </div>
  );
}

// ============================================================================
// Seccion: Cuadro Resumen
// ============================================================================

function SeccionCuadroResumen({
  data,
  competidores,
  clientePropio,
}: {
  data: Kpi[];
  competidores: string[];
  clientePropio: string;
}) {
  const grupos = useMemo(() => {
    const seccionLabels: Record<Kpi["seccion"], string> = {
      datos_generales: "Datos generales",
      cartera: "Cartera",
      eficiencia: "Eficiencia y Productividad",
      rentabilidad: "Rentabilidad",
    };
    const grouped = new Map<Kpi["seccion"], Kpi[]>();
    for (const k of data) {
      if (!grouped.has(k.seccion)) grouped.set(k.seccion, []);
      grouped.get(k.seccion)?.push(k);
    }
    return Array.from(grouped.entries()).map(([seccion, kpis]) => ({
      seccion,
      label: seccionLabels[seccion],
      kpis,
    }));
  }, [data]);

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Cuadro Resumen
      </h2>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider min-w-[260px]">
                  {data.length > 0 ? "" : "KPI"}
                </th>
                {competidores.map((c) => (
                  <th
                    key={c}
                    className={`px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider ${
                      c === clientePropio ? "bg-blue-600" : ""
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <FragmentGrupo key={g.seccion} label={g.label} kpis={g.kpis} competidores={competidores} clientePropio={clientePropio} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FragmentGrupo({
  label,
  kpis,
  competidores,
  clientePropio,
}: {
  label: string;
  kpis: Kpi[];
  competidores: string[];
  clientePropio: string;
}) {
  return (
    <>
      <tr className="bg-slate-100">
        <td colSpan={competidores.length + 1} className="px-4 py-2 text-xs font-bold uppercase text-slate-700 tracking-wider">
          {label}
        </td>
      </tr>
      {kpis.map((k) => {
        const ranks = computeRanks(k.valores, k.signo);
        return (
          <tr key={k.codigo} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-4 py-2 text-slate-700 text-[13px]">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-300 mr-2 align-middle" />
              {k.nombre}
            </td>
            {competidores.map((c) => {
              const v = k.valores.find((x) => x.competidor === c);
              const rank = ranks.get(c);
              const esPropio = c === clientePropio;
              return (
                <td
                  key={c}
                  className={`px-4 py-2 text-right tabular-nums text-[13px] ${
                    esPropio ? "bg-blue-50 font-semibold text-slate-900" : "text-slate-700"
                  }`}
                >
                  {formatValor(v?.valor ?? null, k.unidad)}
                  <RankBadge rank={rank} />
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

// ============================================================================
// Seccion: Punto de Equilibrio Anualizado
// ============================================================================

function SeccionPuntoEquilibrio({
  data,
  competidores,
  clientePropio,
}: {
  data: PuntoEquilibrioRow[];
  competidores: string[];
  clientePropio: string;
}) {
  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Punto de Equilibrio Anualizado
      </h2>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider min-w-[260px]">
                  Componente
                </th>
                {competidores.map((c) => (
                  <th
                    key={c}
                    className={`px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider ${
                      c === clientePropio ? "bg-blue-600" : ""
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, idx) => {
                const isNeg = Object.values(r.valores).every((v) => v < 0);
                const valueClass = isNeg ? "text-rose-700" : "text-emerald-700";
                return (
                  <tr
                    key={idx}
                    className={`border-t border-slate-100 ${
                      r.esTotal ? "bg-amber-50 font-bold border-t-2 border-amber-300" : r.esSubtotal ? "bg-slate-50 font-semibold" : ""
                    }`}
                  >
                    <td className={`px-4 py-2 text-[13px] ${r.indentado ? "pl-10 text-slate-500 italic" : "text-slate-800"}`}>
                      {r.label}
                    </td>
                    {competidores.map((c) => {
                      const v = r.valores[c];
                      const esPropio = c === clientePropio;
                      return (
                        <td
                          key={c}
                          className={`px-4 py-2 text-right tabular-nums text-[13px] ${valueClass} ${
                            esPropio ? "bg-blue-50" : ""
                          } ${r.indentado ? "italic" : ""}`}
                        >
                          {formatValor(v, "pct")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
          <p>
            Indicadores anualizados (acumulado 12 meses) sobre cartera promedio de 12 meses. Las componentes negativas son costos; el Punto de Equilibrio es la suma de costos (fondeo + provisiones + gastos operacionales).
          </p>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Seccion: Margen Neto Bubble Chart
// ============================================================================

function SeccionMargenNetoBubble({
  data,
  competidores,
  comentario,
}: {
  data: InformeData["margenNetoBubble"];
  competidores: InformeData["competidores"];
  comentario: string;
}) {
  // Recharts ScatterChart con bubbles
  const scatterData = data.map((d) => {
    const comp = competidores.find((c) => c.labelCorto === d.competidor);
    return {
      x: d.puntoEq,
      y: d.rendimiento,
      z: d.margenNeto * 100, // tamaño burbuja
      label: d.competidor,
      color: comp?.color ?? "#888",
      deltaPp: d.deltaPp,
      margenNeto: d.margenNeto,
    };
  });

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Analisis Margen Neto — Abr.20 vs Abr.19
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm p-6">
          <p className="text-sm text-slate-500 mb-4">
            Eje X: variacion del Punto de Equilibrio (pp). Eje Y: variacion del Rendimiento de Cartera (pp). Tamaño de burbuja = %Margen Neto actual.
          </p>
          <div style={{ width: "100%", height: 380 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 20, right: 40, bottom: 40, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[-1, 2]}
                  label={{ value: "Punto de Equilibrio (pp)", position: "bottom" }}
                  tickFormatter={(v) => `${v.toFixed(1)}`}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[-3, 1]}
                  label={{ value: "Rendimiento de Cartera (pp)", angle: -90, position: "left" }}
                  tickFormatter={(v) => `${v.toFixed(1)}`}
                />
                <ZAxis type="number" dataKey="z" range={[200, 1500]} />
                <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Tooltip
                  content={(props: { active?: boolean; payload?: Array<{ payload: { label: string; deltaPp: number; margenNeto: number } }> }) => {
                    const { active, payload } = props;
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-slate-200 rounded shadow-lg p-3 text-xs">
                        <p className="font-semibold text-slate-900 mb-1">{d.label}</p>
                        <p className="text-slate-600">Margen neto: <span className="font-mono">{(d.margenNeto * 100).toFixed(2)}%</span></p>
                        <p className="text-slate-600">Delta vs Abr.19: <span className={`font-mono ${d.deltaPp >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{d.deltaPp.toFixed(2)} pp</span></p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#0F2A5E">
                  {scatterData.map((d, i) => (
                    <circle key={i} fill={d.color} fillOpacity={0.7} stroke="#fff" strokeWidth={2} r={0} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {/* Leyenda manual */}
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {competidores.map((c) => (
              <span key={c.nombCorreg} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                {c.labelCorto}
              </span>
            ))}
          </div>
        </div>
        <ComentarioBox texto={comentario} />
      </div>
    </section>
  );
}

// ============================================================================
// Seccion: Margen Neto Waterfall (Abr.20 vs Abr.19)
// ============================================================================

function SeccionMargenNetoWaterfall({
  data,
  competidores,
  comentario,
}: {
  data: InformeData["margenNetoWaterfallVsAbr19"];
  competidores: InformeData["competidores"];
  comentario: string;
}) {
  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Margen Neto — Desviaciones en bps (Abr.20 vs Abr.19)
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
          {data.map((w) => {
            const compConfig = competidores.find((c) => c.labelCorto === w.competidor);
            const color = compConfig?.color ?? "#888";
            return (
              <div key={w.competidor} className="bg-white border border-slate-200 rounded-lg p-3">
                <h3 className="text-xs font-semibold text-center mb-2" style={{ color }}>
                  {w.competidor}
                </h3>
                <Waterfall base={w.base} final={w.final} componentes={w.componentes} totalBps={w.totalBps} color={color} />
              </div>
            );
          })}
        </div>
        <ComentarioBox texto={comentario} />
      </div>
      <div className="mt-3 text-[10px] text-slate-500 px-2">
        Leyenda: <strong>RC</strong> = Rendimiento de Cartera · <strong>CF</strong> = Costo de Fondeo · <strong>CP</strong> = Costo Provisiones · <strong>GO</strong> = Gastos Operacionales · <strong>Ot</strong> = Otros Ingresos y Gastos
      </div>
    </section>
  );
}

function Waterfall({
  base,
  final,
  componentes,
  totalBps,
  color,
}: {
  base: number;
  final: number;
  componentes: { label: string; bps: number }[];
  totalBps: number;
  color: string;
}) {
  // Calculo de alturas: escalado por valor maximo
  const maxAbs = Math.max(base, final, ...componentes.map((c) => Math.abs(c.bps / 100)));
  const scale = 100 / maxAbs; // pixeles por unidad
  const yBase = 110;

  return (
    <div>
      <div className="flex items-end gap-1 h-32 mt-2">
        {/* Base */}
        <BarSegment label="Abr-19" valor={`${base.toFixed(2)}%`} height={base * scale} color={color} />
        {/* Componentes */}
        {componentes.map((c) => (
          <BarSegment
            key={c.label}
            label={c.label}
            valor={c.bps.toString()}
            height={Math.abs(c.bps / 100) * scale}
            color={c.bps >= 0 ? "#94a3b8" : "#FB923C"}
            isComponent
          />
        ))}
        {/* Final */}
        <BarSegment label="Abr-20" valor={`${final.toFixed(2)}%`} height={final * scale} color={color} />
      </div>
      <div className="border-t border-dashed border-amber-400 mt-1 pt-1 text-center">
        <span className={`text-[11px] font-bold ${totalBps >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {totalBps >= 0 ? "+" : ""}{totalBps} bps
        </span>
      </div>
    </div>
  );
}

function BarSegment({
  label,
  valor,
  height,
  color,
  isComponent = false,
}: {
  label: string;
  valor: string;
  height: number;
  color: string;
  isComponent?: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-end">
      <span className="text-[8px] text-slate-500 mb-0.5">{valor}</span>
      <div
        className="w-full rounded-sm"
        style={{
          height: `${Math.max(2, height)}px`,
          backgroundColor: color,
          opacity: isComponent ? 0.7 : 1,
        }}
      />
      <span className="text-[9px] text-slate-700 font-medium mt-0.5">{label}</span>
    </div>
  );
}

// ============================================================================
// Caja de comentario ejecutivo (panel azul del PDF)
// ============================================================================

function ComentarioBox({ texto }: { texto: string }) {
  return (
    <div className="bg-slate-900 text-white rounded-lg p-5 self-start sticky top-20">
      <div className="flex items-start gap-2">
        <svg className="w-5 h-5 flex-shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
          <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
        </svg>
        <p className="text-sm leading-relaxed">{texto}</p>
      </div>
    </div>
  );
}
