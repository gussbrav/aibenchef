"use client";

// Dashboard "Informe Ejecutivo" — replica visual del benchmark Caja
// Arequipa (Junio 2020). Recibe data dinamica desde page.tsx (server)
// que invoca getInformeData() del dominio informe.
//
// Las secciones:
//   1. Header: cliente + periodo + boton descargar PPT
//   2. Toolbar de selectores (periodo + peer group editor)
//   3. Cuadro Resumen
//   4. Punto de Equilibrio Anualizado
//   5. Analisis Margen Neto: bubble + waterfall

import { useMemo, useState } from "react";
import { Download, FileText, Info, AlertCircle } from "lucide-react";
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
import type { TooltipProps } from "recharts";

import type {
  InformeData,
  Kpi,
  KpiValor,
  PuntoEquilibrioRow,
  EntidadDisponible,
  BubblePoint,
  WaterfallData,
  Competidor,
  KpiUnidad,
} from "@/lib/domains/informe";

import { SelectoresToolbar } from "./selectores-toolbar";

// ============================================================================
// Helpers de formato y ranking
// ============================================================================

function formatValor(valor: number | null, unidad: KpiUnidad): string {
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
    case "moneda_miles":
      return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(valor);
    default:
      return String(valor);
  }
}

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

type BubbleChartPayload = {
  label: string;
  deltaPp: number;
  margenNeto: number;
  color: string;
  x: number;
  y: number;
  z: number;
};

// ============================================================================
// Componente principal
// ============================================================================

export function InformeClient({
  data,
  periodosDisponibles,
  entidadesDisponibles,
}: {
  data: InformeData;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
}) {
  const { cliente, periodo, periodoComparativo, competidores, cuadroResumen, puntoEquilibrio, margenNetoBubble, margenNetoWaterfall, comentarios } = data;
  const [exportando, setExportando] = useState(false);

  const onExport = (formato: "pptx" | "pdf") => {
    setExportando(true);
    setTimeout(() => {
      alert(`Export ${formato.toUpperCase()} — feature pendiente (Fase 4 del roadmap). Ver docs/PRODUCT_VISION.md`);
      setExportando(false);
    }, 300);
  };

  // El label que matchea con competidores[i].labelCorto del cliente propio
  const labelCortoPropio = competidores.find((c) => c.esPropio)?.labelCorto ?? cliente.nombreCorto;
  const labelsCompetidores = competidores.map((c) => c.labelCorto);

  const periodoLabel = `${periodo.label} vs ${periodoComparativo.label}`;

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-2">
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
              onClick={() => onExport("pptx")}
              disabled={exportando}
              className="h-9 px-4 bg-white text-slate-900 hover:bg-slate-100 text-sm font-medium rounded transition-colors inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {exportando ? "Generando..." : "Descargar PPT"}
            </button>
            <button
              type="button"
              onClick={() => onExport("pdf")}
              disabled={exportando}
              className="h-9 px-4 bg-white/15 hover:bg-white/25 text-white text-sm font-medium rounded transition-colors inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileText className="w-4 h-4" />
              Descargar PDF
            </button>
          </div>
        </div>
      </header>

      {/* ============ SELECTORES ============ */}
      <SelectoresToolbar
        periodoActual={periodo.codigo}
        peerGroupActual={competidores.map((c) => c.nombCorreg)}
        entidadPropia={cliente.entidadPropia}
        periodosDisponibles={periodosDisponibles}
        entidadesDisponibles={entidadesDisponibles}
      />

      {/* Aviso si no hay competidores o data incompleta */}
      {competidores.length === 0 && (
        <EmptyBox titulo="Sin entidades en el peer group" texto="Selecciona al menos una entidad usando el botón 'Editar' del toolbar." />
      )}

      {/* ============ CUADRO RESUMEN ============ */}
      <SeccionCuadroResumen data={cuadroResumen} competidores={labelsCompetidores} clientePropio={labelCortoPropio} />

      {/* ============ PUNTO DE EQUILIBRIO ============ */}
      <SeccionPuntoEquilibrio data={puntoEquilibrio} competidores={labelsCompetidores} clientePropio={labelCortoPropio} />

      {/* ============ ANALISIS MARGEN NETO — BUBBLE ============ */}
      <SeccionMargenNetoBubble
        data={margenNetoBubble}
        competidores={competidores}
        comentario={comentarios.margen_neto_bubble}
        comparativoLabel={periodoLabel}
      />

      {/* ============ WATERFALL ============ */}
      <SeccionMargenNetoWaterfall
        data={margenNetoWaterfall}
        competidores={competidores}
        comentario={comentarios.margen_neto_waterfall}
        comparativoLabel={periodoLabel}
        periodoBaseLabel={periodoComparativo.label}
        periodoFinalLabel={periodo.label}
      />

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-slate-200 pt-4 pb-8 text-center">
        <p className="text-xs text-slate-500">
          Fuente: SBS · Benchmark generado por Aibenchef · {new Date().toLocaleDateString("es-PE", { dateStyle: "long" })}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          Los KPIs marcados como "—" requieren datasets adicionales (Oficinas, Personal, Clientes, Mora) aun no ingeridos. Ver docs/ROADMAP.md Fase 1.
        </p>
      </footer>
    </div>
  );
}

// ============================================================================
// Cuadro Resumen
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
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider min-w-[260px]" />
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
// Punto de Equilibrio Anualizado
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
  const hayDatos = data.some((r) => Object.values(r.valores).some((v) => v !== null));

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Punto de Equilibrio Anualizado
      </h2>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden mt-4">
        {!hayDatos && (
          <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs text-amber-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              Sin datos calculados para este período. Probablemente faltan 12 meses históricos previos en <code>marts.mv_eeff_resultados_ancho</code> o
              la cuenta <code>cta_a4</code> (cartera) no está poblada. Reintentar con un período más reciente o ejecutar{" "}
              <code>SELECT marts.compute_kpis_punto_equilibrio(periodo)</code> en la base.
            </p>
          </div>
        )}
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
                const valoresNotNull = Object.values(r.valores).filter((v): v is number => v !== null);
                const isNeg = valoresNotNull.length > 0 && valoresNotNull.every((v) => v < 0);
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
            Indicadores anualizados (trailing 12 meses) sobre cartera promedio de 12 meses. Las componentes negativas son costos; el Punto de Equilibrio es la suma de costos (fondeo + provisiones + gastos operacionales). %Margen Neto = %Rendimiento + %Punto Equilibrio + %Otros.
          </p>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Margen Neto — Bubble Chart
// ============================================================================

function SeccionMargenNetoBubble({
  data,
  competidores,
  comentario,
  comparativoLabel,
}: {
  data: BubblePoint[];
  competidores: Competidor[];
  comentario: string;
  comparativoLabel: string;
}) {
  if (data.length === 0) {
    return (
      <section>
        <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
          Analisis Margen Neto — {comparativoLabel}
        </h2>
        <EmptyBox titulo="Sin datos para el bubble chart" texto="Se requieren datos de Punto de Equilibrio del periodo actual y del mismo mes del año anterior." />
      </section>
    );
  }

  const scatterData = data.map((d) => {
    const comp = competidores.find((c) => c.labelCorto === d.competidor);
    return {
      x: d.puntoEq,
      y: d.rendimiento,
      z: Math.abs(d.margenNeto * 100) || 1,
      label: d.competidor,
      color: comp?.color ?? "#888",
      deltaPp: d.deltaPp,
      margenNeto: d.margenNeto,
    };
  });

  const xMin = Math.min(...scatterData.map((d) => d.x)) - 0.5;
  const xMax = Math.max(...scatterData.map((d) => d.x)) + 0.5;
  const yMin = Math.min(...scatterData.map((d) => d.y)) - 0.5;
  const yMax = Math.max(...scatterData.map((d) => d.y)) + 0.5;

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Analisis Margen Neto — {comparativoLabel}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg shadow-sm p-6">
          <p className="text-sm text-slate-500 mb-4">
            Eje X: variación del Punto de Equilibrio (pp). Eje Y: variación del Rendimiento de Cartera (pp). Tamaño de burbuja proporcional al %Margen Neto actual.
          </p>
          <div style={{ width: "100%", height: 380 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 20, right: 40, bottom: 40, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[xMin, xMax]}
                  label={{ value: "Punto de Equilibrio (pp)", position: "bottom" }}
                  tickFormatter={(v) => v.toFixed(1)}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[yMin, yMax]}
                  label={{ value: "Rendimiento de Cartera (pp)", angle: -90, position: "left" }}
                  tickFormatter={(v) => v.toFixed(1)}
                />
                <ZAxis type="number" dataKey="z" range={[200, 1500]} />
                <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                <Tooltip
                  content={(props: TooltipProps<number, string>) => {
                    const { active, payload } = props;
                    if (!active || !payload || payload.length === 0) return null;
                    const d = payload[0].payload as BubbleChartPayload | undefined;
                    if (!d) return null;
                    return (
                      <div className="bg-white border border-slate-200 rounded shadow-lg p-3 text-xs">
                        <p className="font-semibold text-slate-900 mb-1">{d.label}</p>
                        <p className="text-slate-600">Margen neto: <span className="font-mono">{(d.margenNeto * 100).toFixed(2)}%</span></p>
                        <p className="text-slate-600">Delta interanual: <span className={`font-mono ${d.deltaPp >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{d.deltaPp.toFixed(2)} pp</span></p>
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
// Margen Neto — Waterfall (mini-waterfall por competidor)
// ============================================================================

function SeccionMargenNetoWaterfall({
  data,
  competidores,
  comentario,
  comparativoLabel,
  periodoBaseLabel,
  periodoFinalLabel,
}: {
  data: WaterfallData[];
  competidores: Competidor[];
  comentario: string;
  comparativoLabel: string;
  periodoBaseLabel: string;
  periodoFinalLabel: string;
}) {
  if (data.length === 0) {
    return (
      <section>
        <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
          Margen Neto — Desviaciones en bps
        </h2>
        <EmptyBox titulo="Sin datos para el waterfall" texto="Se requieren datos del Punto de Equilibrio para el período actual y el comparativo." />
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900 mb-1 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
        Margen Neto — Desviaciones en bps ({comparativoLabel})
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
                <Waterfall
                  base={w.base}
                  final={w.final}
                  componentes={w.componentes}
                  totalBps={w.totalBps}
                  color={color}
                  baseLabel={periodoBaseLabel}
                  finalLabel={periodoFinalLabel}
                />
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
  baseLabel,
  finalLabel,
}: {
  base: number;
  final: number;
  componentes: { label: string; bps: number }[];
  totalBps: number;
  color: string;
  baseLabel: string;
  finalLabel: string;
}) {
  const maxAbs = Math.max(Math.abs(base), Math.abs(final), ...componentes.map((c) => Math.abs(c.bps / 100)));
  const scale = maxAbs > 0 ? 100 / maxAbs : 1;

  return (
    <div>
      <div className="flex items-end gap-1 h-32 mt-2">
        <BarSegment label={baseLabel} valor={`${base.toFixed(2)}%`} height={Math.abs(base) * scale} color={color} />
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
        <BarSegment label={finalLabel} valor={`${final.toFixed(2)}%`} height={Math.abs(final) * scale} color={color} />
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
      <span className="text-[8px] text-slate-500 mb-0.5 whitespace-nowrap">{valor}</span>
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
// Helpers visuales
// ============================================================================

function ComentarioBox({ texto }: { texto: string }) {
  if (!texto) {
    return (
      <div className="bg-slate-100 text-slate-500 rounded-lg p-5 self-start text-xs italic">
        <p>Sin comentario ejecutivo para este período. Un admin puede agregarlo desde /dashboard/admin/comentarios (pendiente).</p>
      </div>
    );
  }
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

function EmptyBox({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-8 text-center">
      <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-3" />
      <h3 className="text-sm font-semibold text-slate-700 mb-1">{titulo}</h3>
      <p className="text-xs text-slate-500 max-w-md mx-auto">{texto}</p>
    </div>
  );
}
