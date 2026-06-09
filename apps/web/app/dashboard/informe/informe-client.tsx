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

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileText, Info, AlertCircle, AlertTriangle } from "lucide-react";
import { ColorPickerPopover } from "./color-picker-popover";
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
  MargenNetoHistoricoRow,
  PuntoEquilibrioRow,
  EntidadDisponible,
  BubblePoint,
  WaterfallData,
  Competidor,
  KpiUnidad,
} from "@/lib/domains/informe";

import { SelectoresToolbar } from "./selectores-toolbar";
import { SeccionHistoricoComparativo } from "./seccion-historico-comparativo";
import {
  SeccionHistoricoAccordion,
  type AccordionMetric,
} from "./seccion-historico-accordion";

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

/**
 * Indicador de rendimiento relativo por KPI: en lugar de medallas 1-2-3 fijas
 * (que asumen siempre 3 ganadores), computamos un score normalizado por
 * cuartil dentro del peer group activo. Cada entidad recibe uno de 5 tiers:
 *   "top"     — top 25% (mejor performance segun signo)
 *   "high"    — top 50%
 *   "mid"     — mediana
 *   "low"     — bottom 50%
 *   "bottom"  — bottom 25% (peor performance)
 *
 * Asi se muestra TODA la grilla coloreada (no solo el podio), y el color
 * respeta la polaridad del KPI (signo=1 alto es bueno; signo=-1 alto es malo).
 * Si hay menos de 2 valores no-nulos, no se aplica indicador (sin sentido
 * para una sola entidad).
 */
export type PerformanceTier = "top" | "high" | "mid" | "low" | "bottom";

export type PerformanceInfo = {
  tier: PerformanceTier;
  rank: number; // posicion 1..N (1 = mejor)
  total: number; // N de entidades con valor no-nulo
};

function computePerformance(
  valores: KpiValor[],
  signo: 1 | -1,
): Map<string, PerformanceInfo> {
  const out = new Map<string, PerformanceInfo>();
  const withVal = valores.filter((v) => v.valor !== null && v.valor !== undefined);
  if (withVal.length < 2) return out;
  const sorted = [...withVal].sort((a, b) => {
    const av = a.valor as number;
    const bv = b.valor as number;
    return signo === 1 ? bv - av : av - bv;
  });
  const n = sorted.length;
  sorted.forEach((v, i) => {
    const rank = i + 1;
    // Quartil normalizado en [0,1] — 0 mejor, 1 peor.
    const q = n === 1 ? 0 : i / (n - 1);
    let tier: PerformanceTier;
    if (q <= 0.25) tier = "top";
    else if (q <= 0.5) tier = "high";
    else if (q < 0.75) tier = "mid";
    else if (q < 1) tier = "low";
    else tier = "bottom";
    out.set(v.competidor, { tier, rank, total: n });
  });
  return out;
}

/**
 * Conditional formatting tipo Bloomberg/S&P: tinte de fondo sobre la celda
 * numerica + texto en negrita y color en los extremos. Sin dots — el numero
 * queda como protagonista pero el color guia el ojo a los outliers.
 *
 * Top/Bottom destacan claramente; high/low tienen tinte sutil; mid sin
 * tinte. Es el balance entre legibilidad y informacion: el usuario ve
 * inmediatamente quien lidera y quien lleva la peor.
 */
type TierStyle = { cell: string; text: string };

const TIER_STYLE: Record<PerformanceTier, TierStyle> = {
  top:    { cell: "bg-emerald-100", text: "text-emerald-800 font-semibold" },
  high:   { cell: "bg-emerald-50",  text: "" },
  mid:    { cell: "",               text: "" },
  low:    { cell: "bg-amber-50",    text: "" },
  bottom: { cell: "bg-rose-100",    text: "text-rose-800 font-semibold" },
};

const TIER_LABELS: Record<PerformanceTier, string> = {
  top: "Top 25%",
  high: "Top 50%",
  mid: "Medio",
  low: "Bottom 50%",
  bottom: "Bottom 25%",
};

/**
 * Leyenda compacta del heatmap. Mostrada al lado del titulo "Cuadro
 * Resumen". Muestra los 4 tiers visibles (mejor / sobre la mediana / bajo
 * la mediana / peor); el cuartil medio queda sin color.
 */
function PerfLegend() {
  return (
    <div
      className="inline-flex items-center gap-3 text-[10px] text-slate-500 px-3 py-1.5 rounded border border-slate-200 bg-white"
      title="Solo aplica a metricas de calidad (mora, ROA, eficiencia, crecimiento). Las metricas de tamaño / market share / especializacion no se rankean — son contexto, no calidad."
    >
      <span className="font-semibold uppercase tracking-wider text-[9px] text-slate-600">
        vs pares
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" />
        <span className="text-emerald-800 font-semibold">Mejor 25%</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-100" />
        <span>Sobre mediana</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-amber-50 border border-amber-100" />
        <span>Bajo mediana</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded bg-rose-100 border border-rose-200" />
        <span className="text-rose-800 font-semibold">Peor 25%</span>
      </span>
    </div>
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
  const {
    cliente,
    periodo,
    periodoComparativo,
    periodoDicPrev,
    competidores: serverCompetidores,
    cuadroResumen,
    puntoEquilibrio,
    margenNetoHistorico,
    margenNetoBubble,
    margenNetoWaterfall,
    margenNetoWaterfallVsDic,
    oficinasHistorico,
    personalHistorico,
    clientesHistorico,
    rendimientoCarteraHistorico,
    costoFondeoHistorico,
    costoProvisionesHistorico,
    eficienciaHistorico,
    gastosPersonalHistorico,
    gastosGeneralesHistorico,
    utilidadNetaHistorico,
    roeHistorico,
    roaHistorico,
    ingresosFinancierosHistorico,
    gastosFinancierosHistorico,
    margenFinancieroBrutoHistorico,
    margenFinancieroNetoHistorico,
    moraGlobalHistorico,
    moraGlobalVcHistorico,
    coberturaCarHistorico,
    carteraAtrasadaHistorico,
    carHistorico,
    carteraBrutaHistorico,
    comentarios,
  } = data;
  const [exportando, setExportando] = useState(false);

  // ============================================================================
  // colorOverrides CLIENT-SIDE
  // ============================================================================
  // Leemos colorOverrides desde el URL via useSearchParams (reactivo a cambios)
  // y los aplicamos a competidores. Asi los charts (bubble, waterfall, lineas,
  // barras, etc) cambian de color AL INSTANTE cuando el user pickea un color,
  // sin tener que esperar que el Server Component se re-renderee (que en
  // Next.js 15 puede tardar o quedar cacheado).
  //
  // CRITICO: useMemo depende del STRING del param, NO del objeto searchParams.
  // useSearchParams retorna instancias que pueden no cambiar referencia
  // aunque el contenido si — depender del string garantiza recomputo cuando
  // el contenido cambia.
  const searchParamsForColors = useSearchParams();
  const colorOverridesRaw = searchParamsForColors.get("colorOverrides") ?? "";
  const colorOverrides = useMemo(() => {
    const m = new Map<string, string>();
    if (!colorOverridesRaw) return m;
    for (const pair of colorOverridesRaw.split(",")) {
      const idx = pair.lastIndexOf(":");
      if (idx <= 0) continue;
      const nomb = pair.slice(0, idx).trim();
      const hex = pair.slice(idx + 1).trim();
      if (!nomb || !/^#[0-9A-Fa-f]{6}$/.test(hex)) continue;
      m.set(nomb, hex);
    }
    return m;
  }, [colorOverridesRaw]);
  const competidores = useMemo(
    () =>
      serverCompetidores.map((c) => {
        const override = colorOverrides.get(c.nombCorreg);
        return override ? { ...c, color: override } : c;
      }),
    [serverCompetidores, colorOverrides],
  );

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
              <span className="text-xs uppercase opacity-75">Comparativa:</span>
              {competidores.map((c) => (
                <EntidadChip
                  key={c.nombCorreg}
                  nombCorreg={c.nombCorreg}
                  labelCorto={c.labelCorto}
                  color={c.color}
                  esPropio={c.esPropio}
                />
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
      <Suspense fallback={<div className="h-12" />}>
        <SelectoresToolbarConTema
          periodoActual={periodo.codigo}
          peerGroupActual={competidores.map((c) => c.nombCorreg)}
          entidadPropia={cliente.entidadPropia}
          periodosDisponibles={periodosDisponibles}
          entidadesDisponibles={entidadesDisponibles}
        />
      </Suspense>

      {/* Cobertura: aviso si hay entidades del peer group sin data en las MVs */}
      {data.cobertura.entidadesSinData.length > 0 && (
        <CoberturaWarning cobertura={data.cobertura} />
      )}

      {competidores.length === 0 && (
        <EmptyBox titulo="Sin entidades en el peer group" texto="Selecciona al menos una entidad usando el botón 'Editar' del toolbar." />
      )}

      {/* ============ CUADRO RESUMEN ============ */}
      <SeccionCuadroResumen data={cuadroResumen} competidores={labelsCompetidores} clientePropio={labelCortoPropio} />

      {/* ============ PUNTO DE EQUILIBRIO ============ */}
      <SeccionPuntoEquilibrio
        data={puntoEquilibrio}
        margenNetoHistorico={margenNetoHistorico}
        competidores={labelsCompetidores}
        clientePropio={labelCortoPropio}
      />

      {/* ============ ANALISIS MARGEN NETO — BUBBLE ============ */}
      <SeccionMargenNetoBubble
        data={margenNetoBubble}
        competidores={competidores}
        comentario={comentarios.margen_neto_bubble}
        comparativoLabel={periodoLabel}
      />

      {/* ============ WATERFALL vs mismo mes año previo ============ */}
      <SeccionMargenNetoWaterfall
        data={margenNetoWaterfall}
        competidores={competidores}
        comentario={comentarios.margen_neto_waterfall}
        comparativoLabel={periodoLabel}
        periodoBaseLabel={periodoComparativo.label}
        periodoFinalLabel={periodo.label}
      />

      {/* ============ WATERFALL vs Dic año previo ============ */}
      <SeccionMargenNetoWaterfall
        data={margenNetoWaterfallVsDic}
        competidores={competidores}
        comentario={""}
        comparativoLabel={`${periodo.label} vs ${periodoDicPrev.label}`}
        periodoBaseLabel={periodoDicPrev.label}
        periodoFinalLabel={periodo.label}
      />

      {/* ============ TENDENCIAS HISTORICAS (lazy-load) ============
          Cada seccion arranca COLAPSADA y solo fetcha su data cuando el
          usuario la expande. La pagina principal carga rapido porque el
          SSR no hace estas queries; cada accordion las pide a
          /api/v1/informe/historico bajo demanda. Misma data, mejor UX. */}
      <div className="space-y-2 mt-4">
        <SectionsAccordion
          periodo={periodo.codigo}
          peerGroup={competidores.map((c) => c.nombCorreg)}
        />
      </div>

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
      <div className="flex items-end justify-between gap-4 flex-wrap mb-1">
        <h2 className="text-xl font-bold text-slate-900 inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 text-white">
          Cuadro Resumen
        </h2>
        <PerfLegend />
      </div>
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
        // Solo aplicar heatmap si la metrica representa calidad (no tamaño).
        // rankeable !== false (default true) habilita el ranking visual.
        const heatmapOn = k.rankeable !== false;
        const perf = heatmapOn ? computePerformance(k.valores, k.signo) : new Map<string, PerformanceInfo>();
        return (
          <tr key={k.codigo} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-4 py-2 text-slate-700 text-[13px]">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-300 mr-2 align-middle" />
              {k.nombre}
              {k.tooltip && (
                <span
                  className="ml-1.5 inline-flex items-center cursor-help"
                  title={k.tooltip}
                  aria-label={k.tooltip}
                >
                  <Info className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 inline align-middle" />
                </span>
              )}
            </td>
            {competidores.map((c) => {
              const v = k.valores.find((x) => x.competidor === c);
              const info = perf.get(c);
              const esPropio = c === clientePropio;
              const style = info ? TIER_STYLE[info.tier] : { cell: "", text: "" };
              const tooltip = info
                ? `${TIER_LABELS[info.tier]} · #${info.rank} de ${info.total}`
                : undefined;
              // El propio cliente mantiene su highlight azul (es su perspectiva).
              // El heatmap se aplica solo a los competidores.
              return (
                <td
                  key={c}
                  title={tooltip}
                  className={`px-4 py-2 text-right tabular-nums text-[13px] ${
                    esPropio
                      ? "bg-blue-50 font-semibold text-slate-900"
                      : `${style.cell} ${style.text || "text-slate-700"}`
                  }`}
                >
                  {formatValor(v?.valor ?? null, k.unidad)}
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
  margenNetoHistorico,
  competidores,
  clientePropio,
}: {
  data: PuntoEquilibrioRow[];
  margenNetoHistorico: MargenNetoHistoricoRow[];
  competidores: string[];
  clientePropio: string;
}) {
  // Sacamos %Margen Neto del array principal — lo renderizamos en la seccion
  // historica comparativa con 3 cortes (actual / Dic año previo / mismo mes año previo).
  const dataPrincipal = data.filter((r) => r.label !== "%Margen Neto");
  const hayDatos = dataPrincipal.some((r) => Object.values(r.valores).some((v) => v !== null));

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
              {dataPrincipal.map((r, idx) => {
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
              {/* %Margen Neto comparativo: actual + Dic año previo + mismo mes año previo */}
              {margenNetoHistorico.map((row, idx) => {
                const valoresNotNull = Object.values(row.valores).filter((v): v is number => v !== null);
                const todosPositivos = valoresNotNull.length > 0 && valoresNotNull.every((v) => v >= 0);
                const valueClass = todosPositivos ? "text-emerald-700" : "text-rose-700";
                const esActual = idx === 0;
                return (
                  <tr
                    key={`mn-${row.periodo}`}
                    className={`border-t ${esActual ? "border-t-2 border-amber-300 bg-amber-50 font-bold" : "border-slate-100 bg-amber-50/40 font-semibold"}`}
                  >
                    <td className="px-4 py-2 text-[13px] text-slate-800">
                      <span className="inline-block w-14 text-[11px] text-slate-500 uppercase tracking-wider mr-2">
                        {row.periodoLabel}
                      </span>
                      %Margen Neto
                    </td>
                    {competidores.map((c) => {
                      const v = row.valores[c];
                      const esPropio = c === clientePropio;
                      return (
                        <td
                          key={c}
                          className={`px-4 py-2 text-right tabular-nums text-[13px] ${valueClass} ${esPropio ? "bg-blue-50" : ""}`}
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
              <ScatterChart margin={{ top: 30, right: 40, bottom: 50, left: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[xMin, xMax]}
                  label={{ value: "Punto de Equilibrio (pp)", position: "insideBottom", offset: -15 }}
                  tickFormatter={(v) => v.toFixed(1)}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[yMin, yMax]}
                  label={{
                    value: "Rendimiento de Cartera (pp)",
                    angle: -90,
                    position: "insideLeft",
                    offset: 0,
                    style: { textAnchor: "middle" },
                  }}
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
                      <div className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs min-w-[200px]">
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                          <p className="font-semibold text-slate-900">{d.label}</p>
                        </div>
                        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-slate-600">
                          <span>Margen neto actual</span>
                          <span className="font-mono font-semibold text-slate-900">
                            {(d.margenNeto * 100).toFixed(2)}%
                          </span>
                          <span>Δ Punto Equilibrio</span>
                          <span className={`font-mono ${d.x >= 0 ? "text-rose-700" : "text-emerald-700"}`}>
                            {d.x >= 0 ? "+" : ""}{d.x.toFixed(2)} pp
                          </span>
                          <span>Δ Rendimiento</span>
                          <span className={`font-mono ${d.y >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {d.y >= 0 ? "+" : ""}{d.y.toFixed(2)} pp
                          </span>
                          <span className="border-t border-slate-100 pt-1 mt-1">Δ Margen Neto</span>
                          <span className={`font-mono font-semibold border-t border-slate-100 pt-1 mt-1 ${d.deltaPp >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {d.deltaPp >= 0 ? "+" : ""}{d.deltaPp.toFixed(2)} pp
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={scatterData}
                  isAnimationActive={true}
                  animationDuration={600}
                  shape={(props: { cx?: number; cy?: number; size?: number; payload?: BubbleChartPayload }) => {
                    const { cx, cy, size, payload } = props;
                    if (cx == null || cy == null || !payload) return <g />;
                    // size viene del ZAxis range (200..1500); es AREA en px^2.
                    // Convertir a radio: r = sqrt(area/PI).
                    const area = typeof size === "number" && size > 0 ? size : 600;
                    const r = Math.sqrt(area / Math.PI);
                    return (
                      <g>
                        {/* halo sutil */}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r + 3}
                          fill={payload.color}
                          fillOpacity={0.18}
                        />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill={payload.color}
                          fillOpacity={0.85}
                          stroke="#fff"
                          strokeWidth={2}
                          style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.18))" }}
                        />
                        {/* label dentro/encima de la burbuja */}
                        <text
                          x={cx}
                          y={cy - r - 6}
                          textAnchor="middle"
                          className="text-[10px] font-semibold"
                          fill="#0f172a"
                          style={{
                            paintOrder: "stroke",
                            stroke: "#ffffff",
                            strokeWidth: 3,
                            strokeLinejoin: "round",
                          }}
                        >
                          {payload.label}
                        </text>
                      </g>
                    );
                  }}
                />
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
      <p className="text-xs text-slate-500 mt-2 px-2">
        <strong>bps</strong> = <em>basis points</em> o puntos b&aacute;sicos. 1 bps = 0.01% =
        1/100 de punto porcentual. As&iacute; un cambio de 100 bps equivale a 1 pp (punto porcentual).
      </p>
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
      <div className="mt-3 text-[10px] text-slate-500 px-2 space-y-1">
        <p>
          <strong>Componentes (descomposici&oacute;n del cambio):</strong>{" "}
          <strong>RC</strong> = Rendimiento de Cartera ·{" "}
          <strong>CF</strong> = Costo de Fondeo ·{" "}
          <strong>CP</strong> = Costo Provisiones ·{" "}
          <strong>GO</strong> = Gastos Operacionales ·{" "}
          <strong>Ot</strong> = Otros Ingresos y Gastos
        </p>
        <p>
          <strong>Unidad bps:</strong> 1 bps = 0.01% = 1/100 de punto porcentual. Total al pie de cada
          gr&aacute;fico = suma de los componentes en bps (delta del Margen Neto entre ambos cierres).
        </p>
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

  // Items en una sola estructura. Cada item se renderea en 3 filas (valor /
  // barra / label) que comparten ancho via grid-cols. Asi las barras quedan
  // alineadas al mismo nivel sin importar si el label tiene 1 o 2 lineas.
  type WfItem = { label: string; valor: string; height: number; color: string; isComponent: boolean };
  const items: WfItem[] = [
    { label: baseLabel, valor: `${base.toFixed(2)}%`, height: Math.abs(base) * scale, color, isComponent: false },
    ...componentes.map<WfItem>((c) => ({
      label: c.label,
      valor: c.bps.toString(),
      height: Math.abs(c.bps / 100) * scale,
      color: c.bps >= 0 ? "#94a3b8" : "#FB923C",
      isComponent: true,
    })),
    { label: finalLabel, valor: `${final.toFixed(2)}%`, height: Math.abs(final) * scale, color, isComponent: false },
  ];

  const gridCols = { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` };

  return (
    <div>
      {/* Fila 1: valores arriba de cada barra */}
      <div className="grid gap-1 mt-2" style={gridCols}>
        {items.map((it, i) => (
          <div key={`v-${i}`} className="text-[8px] text-slate-500 text-center truncate" title={it.valor}>
            {it.valor}
          </div>
        ))}
      </div>

      {/* Fila 2: barras alineadas al fondo, todas terminan al mismo nivel */}
      <div className="grid items-end gap-1 h-28" style={gridCols}>
        {items.map((it, i) => (
          <div
            key={`b-${i}`}
            className="w-full rounded-sm"
            style={{
              height: `${Math.max(2, it.height)}px`,
              backgroundColor: it.color,
              opacity: it.isComponent ? 0.7 : 1,
            }}
          />
        ))}
      </div>

      {/* Fila 3: labels con altura fija (h-8) para acomodar hasta 2 lineas */}
      <div className="grid items-start gap-1 mt-1 h-8" style={gridCols}>
        {items.map((it, i) => (
          <div
            key={`l-${i}`}
            className="text-[9px] text-slate-700 font-medium text-center leading-[1.15] break-words"
          >
            {it.label}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-amber-400 mt-1 pt-1 text-center">
        <span className={`text-[11px] font-bold ${totalBps >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {totalBps >= 0 ? "+" : ""}{totalBps} bps
        </span>
      </div>
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

// ============================================================================
// Wrapper que lee `consolidar` del URL y lo pasa al toolbar
// ============================================================================

function SelectoresToolbarConTema(props: {
  periodoActual: number;
  peerGroupActual: string[];
  entidadPropia: string;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
}) {
  const sp = useSearchParams();
  // consolidar: default true; solo es false si la URL tiene ?consolidar=false
  const consolidar = sp.get("consolidar") !== "false";
  return <SelectoresToolbar {...props} consolidarActual={consolidar} />;
}

// ============================================================================
// Warning de cobertura — entidades del peer group sin data en las MVs
// ============================================================================

function CoberturaWarning({ cobertura }: { cobertura: InformeData["cobertura"] }) {
  const { entidadesSinData, sugerenciasMatch, entidadesConData } = cobertura;
  const total = entidadesSinData.length + entidadesConData.length;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-900 mb-1">
            {entidadesSinData.length} de {total} entidades sin data en las MVs
          </h3>
          <p className="text-xs text-amber-800 mb-3">
            Las siguientes entidades no tienen filas en <code className="bg-amber-100 px-1 rounded">marts.v_eeff_balance_ancho</code> para este periodo.
            Probablemente el nombre no coincide con <code className="bg-amber-100 px-1 rounded">dw.dim_entidad.nomb_correg</code> o falta cargar el periodo.
          </p>
          <ul className="space-y-2">
            {entidadesSinData.map((nomb) => {
              const sugerencias = sugerenciasMatch[nomb] ?? [];
              return (
                <li key={nomb} className="text-xs">
                  <p className="font-mono text-amber-900">
                    <span className="text-rose-600 font-bold">✗</span> {nomb}
                  </p>
                  {sugerencias.length > 0 ? (
                    <p className="ml-4 text-amber-700">
                      Sugerencias: {sugerencias.map((s) => <code key={s} className="bg-white border border-amber-300 px-1 rounded mr-1">{s}</code>)}
                    </p>
                  ) : (
                    <p className="ml-4 text-amber-700 italic">Sin sugerencias en dim_entidad.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-amber-700 mt-3">
            <strong>Tip:</strong> click en "Editar" del peer group para reemplazar estas entidades por las correctas.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SectionsAccordion — lista de 23 secciones historicas en accordion lazy-load.
// Cada item arranca colapsado; al expandir fetcha su data al endpoint
// /api/v1/informe/historico?metric=X. Mismo peerGroup + periodo en TODAS.
// ============================================================================
const ACCORDION_SECTIONS: Array<{
  metric: AccordionMetric;
  titulo: string;
  subtitulo: string;
  formatoValor: "numero" | "pct" | "moneda_mm";
}> = [
  { metric: "carteraBruta",    titulo: "CARTERA BRUTA",                                    subtitulo: "Saldo de Cartera por entidad (MM S/)",                          formatoValor: "moneda_mm" },
  { metric: "oficinas",        titulo: "N° DE OFICINAS",                                   subtitulo: "Tendencia ultimos 5 periodos",                                  formatoValor: "numero"    },
  { metric: "personal",        titulo: "N° DE PERSONAL",                                   subtitulo: "Tendencia ultimos 5 periodos",                                  formatoValor: "numero"    },
  { metric: "clientes",        titulo: "N° DE CLIENTES DE CRÉDITO (Miles)",                subtitulo: "Tendencia ultimos 5 periodos",                                  formatoValor: "numero"    },
  { metric: "rendimiento",     titulo: "RENDIMIENTO DE CARTERA",                           subtitulo: "Anualizado TTM",                                                formatoValor: "pct"       },
  { metric: "costoFondeo",     titulo: "COSTO DE FONDEO",                                  subtitulo: "Anualizado TTM",                                                formatoValor: "pct"       },
  { metric: "provisiones",     titulo: "COSTO DE PROVISIONES",                             subtitulo: "Gasto Provisiones / Cartera Bruta Prom",                        formatoValor: "pct"       },
  { metric: "eficiencia",      titulo: "EFICIENCIA — Gastos Op / Margen Bruto",            subtitulo: "Anualizado TTM",                                                formatoValor: "pct"       },
  { metric: "gastosPersonal",  titulo: "GASTOS DE PERSONAL / Margen Bruto",                subtitulo: "Anualizado TTM",                                                formatoValor: "pct"       },
  { metric: "gastosGenerales", titulo: "GASTOS GENERALES / Margen Bruto",                  subtitulo: "Anualizado TTM",                                                formatoValor: "pct"       },
  { metric: "ingresos",        titulo: "INGRESOS FINANCIEROS",                             subtitulo: "Anualizado TTM — MM S/",                                        formatoValor: "moneda_mm" },
  { metric: "gastos",          titulo: "GASTOS FINANCIEROS",                               subtitulo: "Anualizado TTM — MM S/",                                        formatoValor: "moneda_mm" },
  { metric: "margenBruto",     titulo: "MARGEN FINANCIERO BRUTO",                          subtitulo: "(Ingresos − Gastos) Financieros, TTM",                          formatoValor: "moneda_mm" },
  { metric: "margenNeto",      titulo: "MARGEN FINANCIERO NETO",                           subtitulo: "Margen Bruto + INOF Neto (TTM)",                                formatoValor: "moneda_mm" },
  { metric: "utilidad",        titulo: "RENTABILIDAD — Utilidad Neta",                     subtitulo: "Anualizada TTM — MM S/",                                        formatoValor: "moneda_mm" },
  { metric: "roe",             titulo: "RENTABILIDAD — % ROE",                             subtitulo: "Utilidad TTM / Patrimonio promedio 12m",                        formatoValor: "pct"       },
  { metric: "roa",             titulo: "RENTABILIDAD — % ROA",                             subtitulo: "Utilidad TTM / Activos promedio 12m",                           formatoValor: "pct"       },
  { metric: "mora",            titulo: "CALIDAD DE CARTERA — % Mora Global",               subtitulo: "(Atrasada + Refinanciada + Castigos 12m) / Cartera Bruta",     formatoValor: "pct"       },
  { metric: "moraVc",          titulo: "CALIDAD DE CARTERA — % Mora Global (con V/C)",     subtitulo: "Incluye venta de cartera 12m en el numerador",                  formatoValor: "pct"       },
  { metric: "atrasada",        titulo: "INDICADORES DE CALIDAD — % Cartera Atrasada",      subtitulo: "Cartera Atrasada / Cartera Bruta",                              formatoValor: "pct"       },
  { metric: "car",             titulo: "INDICADORES DE CALIDAD — % Cartera de Alto Riesgo", subtitulo: "(Atrasada + Refinanciada) / Cartera Bruta",                    formatoValor: "pct"       },
  { metric: "cobCar",          titulo: "COBERTURA CARTERA ALTO RIESGO",                    subtitulo: "Provisiones / Cartera Alto Riesgo",                             formatoValor: "pct"       },
];

function SectionsAccordion({
  periodo,
  peerGroup,
}: {
  periodo: number;
  peerGroup: string[];
}) {
  return (
    <>
      {ACCORDION_SECTIONS.map((s) => (
        <SeccionHistoricoAccordion
          key={s.metric}
          metric={s.metric}
          titulo={s.titulo}
          subtitulo={s.subtitulo}
          formatoValor={s.formatoValor}
          periodo={periodo}
          peerGroup={peerGroup}
        />
      ))}
    </>
  );
}

/**
 * Chip de entidad en la barra COMPARATIVA del header. Click abre el popover
 * de color picker para customizar el color de esa entidad. La entidad propia
 * (esPropio) muestra fondo blanco y NO tiene picker (el cliente customiza
 * via tema/peer_group config).
 */
function EntidadChip({
  nombCorreg,
  labelCorto,
  color,
  esPropio,
}: {
  nombCorreg: string;
  labelCorto: string;
  color: string;
  esPropio: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Estado local optimista: el chip muestra este color sin esperar que el
  // server re-renderee. Si el user override desde el picker -> se actualiza
  // al instante. Si el server re-llega con otro color (via useEffect), sync.
  const [liveColor, setLiveColor] = useState(color);

  // Sync cuando el server prop cambia (RSC re-fetch llego).
  // Tambien sync cuando esPropio cambia (resaltar otra entidad).
  useEffect(() => {
    setLiveColor(color);
  }, [color]);

  // Estilos diferenciados:
  // - esPropio: fondo blanco solido con texto oscuro (visual destacado)
  //   pero igual clickable para customizar color (afecta charts/headers)
  // - competidor: fondo semi-transparente con border-left del color
  const chipStyle = esPropio
    ? {
        backgroundColor: "#ffffff",
        color: "#0f172a",
        fontWeight: 600,
        borderLeft: `3px solid ${liveColor}`,
      }
    : {
        borderLeft: `3px solid ${liveColor}`,
      };

  const chipClassName = esPropio
    ? "text-[11px] px-2 py-0.5 rounded hover:bg-slate-100 transition-colors cursor-pointer"
    : "text-[11px] px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 transition-colors cursor-pointer";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={chipClassName}
        style={chipStyle}
        title="Click para cambiar el color"
      >
        {labelCorto}
      </button>
      {open && (
        <ColorPickerPopover
          nombCorreg={nombCorreg}
          labelCorto={labelCorto}
          currentColor={liveColor}
          triggerRef={triggerRef}
          onColorChange={(hex) => {
            // hex === null -> reset al color del server
            setLiveColor(hex ?? color);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
