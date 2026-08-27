"use client";

// Dashboard "Informe Ejecutivo" — replica visual del benchmark Caja
// Arequipa (Junio 2020). Recibe data dinamica desde page.tsx (server)
// que invoca getInformeData() del dominio informe.
//
// Las secciones:
//   1. Header: cliente + periodo + boton Descargar PDF (via window.print)
//   2. Toolbar de selectores (periodo + peer group editor)
//   3. Cuadro Resumen
//   4. Punto de Equilibrio Anualizado
//   5. Analisis Margen Neto: bubble + waterfall

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, HelpCircle, Info, AlertCircle, AlertTriangle, Paintbrush, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { FormulaPopover } from "@/components/ui";
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
import type { PeriodoCompletenessStatus } from "@/lib/domains/informe/queries";

import { waitForPrintFetches } from "@/lib/print-orchestrator";
import { SelectoresToolbar } from "./selectores-toolbar";
import { SeccionHistoricoComparativo } from "./seccion-historico-comparativo";
// Solo el TYPE se importa eager (no arrastra runtime). El componente
// SeccionHistoricoAccordion va en dynamic import abajo.
import type { AccordionMetric } from "./seccion-historico-accordion";

// ============================================================================
// DYNAMIC IMPORTS — perf split del bundle client
// ============================================================================
// PrintCover stack (~272 loc): solo se ve al imprimir → ssr:false, lazy.
// SeccionHistoricoAccordion (~477 loc + recharts BarChart via seccion-
// historico-comparativo): below-the-fold, colapsado por default. El chunk
// arrastra recharts a lazy. Placeholder skeleton mientras carga.
// ColorPickerPopover, PeriodoCompletenessBadge, ReportInsights: interactivos
// on-demand (popover, badge, panel AI) — no bloquean first paint.
// ============================================================================
const PrintCover = dynamic(() => import("./print-cover").then((m) => m.PrintCover), { ssr: false, loading: () => null });
const PrintFooter = dynamic(() => import("./print-cover").then((m) => m.PrintFooter), { ssr: false, loading: () => null });
const PrintRunningFooter = dynamic(() => import("./print-cover").then((m) => m.PrintRunningFooter), { ssr: false, loading: () => null });
const PrintRunningHeader = dynamic(() => import("./print-cover").then((m) => m.PrintRunningHeader), { ssr: false, loading: () => null });
const PrintWatermark = dynamic(() => import("./print-cover").then((m) => m.PrintWatermark), { ssr: false, loading: () => null });

const SeccionHistoricoAccordion = dynamic(
  () => import("./seccion-historico-accordion").then((m) => m.SeccionHistoricoAccordion),
  { loading: () => <div className="h-14 bg-slate-100 rounded-lg animate-pulse" /> },
);

const ColorPickerPopover = dynamic(
  () => import("./color-picker-popover").then((m) => m.ColorPickerPopover),
  { ssr: false },
);
const PeriodoCompletenessBadge = dynamic(
  () => import("./periodo-completeness-badge").then((m) => m.PeriodoCompletenessBadge),
  { ssr: false, loading: () => null },
);
const SeccionCalidadCartera = dynamic(
  () => import("./calidad-cartera-section").then((m) => m.SeccionCalidadCartera),
  { ssr: false, loading: () => null },
);
const ReportInsights = dynamic(
  () => import("./report-insights").then((m) => m.ReportInsights),
  { loading: () => null },
);

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
 * Conditional formatting tipo terminal financiera: tinte de fondo sobre la celda
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
  /** Lado del label calculado para evitar overlap con burbujas vecinas. */
  labelSide: "top" | "bottom";
};

// ============================================================================
// Componente principal
// ============================================================================

export function InformeClient({
  data,
  periodosDisponibles,
  entidadesDisponibles,
  completenessStatus,
  planLimited = false,
  planMaxPeers,
  insightsAllowed = true,
  publicacionesAllowed = false,
  isAdmin = false,
}: {
  data: InformeData;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
  completenessStatus: PeriodoCompletenessStatus | null;
  /** Flag server-side: true si la vista esta topada por plan (V167). */
  planLimited?: boolean;
  /** Numero maximo de competidores del plan del user, si aplica. */
  planMaxPeers?: number;
  /** V167: false para plan Free — oculta el panel de insights AI. */
  insightsAllowed?: boolean;
  /** Publicaciones IA: true si el plan tiene publicacionesPorMes > 0
   *  (Trial=3, Pro=20, Business=999). Free = false. Usado en secciones
   *  con boton "Generar publicacion IA" para gate cliente-side. */
  publicacionesAllowed?: boolean;
  /** V178: si es admin, el badge de completeness muestra boton "Verificar
   *  de nuevo con SBS" para encolar sync_job del periodo activo. */
  isAdmin?: boolean;
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
  /**
   * Modo print: cuando true, los accordions se auto-abren y fetchan sus
   * datos. Se activa antes de disparar window.print() para que el PDF
   * contenga todas las secciones sin que el usuario tenga que abrirlas.
   */
  const [printMode, setPrintMode] = useState(false);
  /** Progreso visible en el boton mientras esperamos que carguen los accordions. */
  const [printProgress, setPrintProgress] = useState<string | null>(null);

  // ============================================================================
  // colorOverrides como CLIENT STATE (single source of truth)
  // ============================================================================
  // Arquitectura "world-class" para color picking instantaneo:
  //
  // 1. El estado vive en useState — INSTANT a cualquier cambio
  // 2. El URL es DERIVED state — se sincroniza via useEffect + startTransition
  //    en background, sin bloquear el render
  // 3. Init desde URL (para soportar URLs compartidos + reload)
  // 4. Sync FROM url solo si cambia por navegacion externa (back/forward),
  //    no cuando nosotros mismos lo cambiamos (evita loop infinito)
  //
  // Resultado: clicks en el color picker son completamente sincrónos a nivel
  // UI. URL eventualmente consistente para sharing/reload.
  const pathname = usePathname();
  const searchParamsForColors = useSearchParams();

  const parseFromUrl = (raw: string): Map<string, string> => {
    const m = new Map<string, string>();
    if (!raw) return m;
    for (const pair of raw.split(",")) {
      const idx = pair.lastIndexOf(":");
      if (idx <= 0) continue;
      const nomb = pair.slice(0, idx).trim();
      const hex = pair.slice(idx + 1).trim();
      if (!nomb || !/^#[0-9A-Fa-f]{6}$/.test(hex)) continue;
      m.set(nomb, hex);
    }
    return m;
  };
  const serializeForUrl = (m: Map<string, string>): string =>
    Array.from(m.entries())
      .map(([k, v]) => `${k}:${v}`)
      .join(",");

  // Estado: inicial desde URL (SSR-friendly, soporta URLs compartidos)
  const colorOverridesRaw = searchParamsForColors.get("colorOverrides") ?? "";
  const [colorOverrides, setColorOverrides] = useState<Map<string, string>>(() =>
    parseFromUrl(colorOverridesRaw),
  );
  // Ref para distinguir cambios propios vs externos (back/forward)
  const lastUrlSyncRef = useRef<string>(colorOverridesRaw);

  // Sync FROM URL — solo si cambio externamente (no por nuestro propio update)
  useEffect(() => {
    if (colorOverridesRaw === lastUrlSyncRef.current) return;
    lastUrlSyncRef.current = colorOverridesRaw;
    const fromUrl = parseFromUrl(colorOverridesRaw);
    setColorOverrides(fromUrl);
  }, [colorOverridesRaw]);

  // Sync TO URL — usando window.history.replaceState DIRECTO en vez de
  // router.replace de Next.js. Razon: router.replace en Next.js 15 ignora
  // scroll:false en algunos casos y scrollea al top, ademas dispara un
  // re-render del RSC que en deploys con cache puede pisar el state client.
  // window.history.replaceState solo cambia el URL en la barra, sin scroll,
  // sin re-render, sin nada — perfecto para 'derived state' como aca.
  //
  // Debounce 300ms para que cambios rapidos (probar 5 colores seguidos)
  // generen 1 sola actualizacion de URL al final, no 5.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const serialized = serializeForUrl(colorOverrides);
      if (serialized === colorOverridesRaw) return;
      lastUrlSyncRef.current = serialized;
      const next = new URLSearchParams(searchParamsForColors.toString());
      if (serialized) next.set("colorOverrides", serialized);
      else next.delete("colorOverrides");
      const newUrl = `${pathname}?${next.toString()}`;
      window.history.replaceState(window.history.state, "", newUrl);
    }, 300);
    return () => clearTimeout(timeout);
  }, [colorOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

  // Setter expuesto al color picker: actualiza state INSTANT
  const setColorForEntity = (nombCorreg: string, hex: string | null) => {
    setColorOverrides((prev) => {
      const next = new Map(prev);
      if (hex === null) next.delete(nombCorreg);
      else next.set(nombCorreg, hex);
      return next;
    });
  };

  // Reset all colors — UX de "deshacer global"
  const resetAllColors = () => setColorOverrides(new Map());

  const competidores = useMemo(
    () =>
      serverCompetidores.map((c) => {
        const override = colorOverrides.get(c.nombCorreg);
        return override ? { ...c, color: override } : c;
      }),
    [serverCompetidores, colorOverrides],
  );

  // Export a PDF completo:
  //   1. Activa printMode -> todos los accordions se auto-abren + fetchan.
  //   2. Espera a que TODOS los fetches se resuelvan (o timeout 10s).
  //   3. Dispara window.print() del navegador — usuario elige 'Guardar
  //      como PDF' en el dialogo.
  //   4. Al cerrarse el dialogo, resetea printMode.
  //
  // Sin printMode, el PDF quedaria incompleto porque los accordions cerrados
  // no estan en el DOM. Ahora garantizamos captura total con un solo click.
  const onExport = async () => {
    if (exportando) return;
    setExportando(true);
    setPrintProgress("Abriendo todas las secciones…");
    setPrintMode(true);

    // Doble rAF: da tiempo a React de renderizar los accordions abiertos
    // y a sus useEffects de disparar los fetches + registrarlos.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    setPrintProgress("Cargando datos…");
    const { total, timedOut } = await waitForPrintFetches(10000);
    if (timedOut) {
      // eslint-disable-next-line no-console
      console.warn(`[print] timeout esperando ${total} fetches; imprimo con lo que hay`);
    }

    // Un tick mas para que las series recien llegadas se pinten (recharts
    // hace animacion inicial pero setAnimationActive={false} en nuestros
    // charts, asi que un rAF alcanza).
    setPrintProgress("Renderizando graficos…");
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 300));

    setPrintProgress(null);
    window.print();

    // Chrome no expone evento post-print confiable; usamos un timeout
    // generoso para asumir que el dialogo se cerro.
    setTimeout(() => {
      setPrintMode(false);
      setExportando(false);
    }, 800);
  };

  // El label que matchea con competidores[i].labelCorto del cliente propio
  const labelCortoPropio = competidores.find((c) => c.esPropio)?.labelCorto ?? cliente.nombreCorto;
  const labelsCompetidores = competidores.map((c) => c.labelCorto);

  const periodoLabel = `${periodo.label} vs ${periodoComparativo.label}`;

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-2 animate-premium-in">
      {/* ============ PORTADA PDF (solo visible al imprimir) ============ */}
      <PrintCover
        clienteNombre={cliente.nombre}
        clienteSlug={cliente.slug}
        periodo={periodo.codigo}
        periodoLabel={periodo.label}
        periodoComparativoLabel={periodoComparativo.label}
        peerGroup={competidores.map((c) => ({ nombre: c.nombCorreg, color: c.color }))}
        entidadPropia={cliente.entidadPropia}
        brandPrimary={cliente.brand.primary}
        brandAcento={cliente.brand.acento}
      />

      {/* Running header/footer + watermark: fixed en cada pagina de contenido */}
      <PrintRunningHeader clienteNombre={cliente.nombre} periodoLabel={periodo.label} />
      <PrintRunningFooter clienteNombre={cliente.nombre} />
      <PrintWatermark />

      {/* ============ HEADER ============ */}
      <header
        className="rounded-xl text-white p-8 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${cliente.brand.primary} 0%, ${cliente.brand.acento} 100%)` }}
      >
        <div className="flex items-start justify-between gap-6 flex-wrap relative z-10">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-75 mb-2">Informe Ejecutivo de Benchmark</p>
            <h1 className="text-3xl font-bold mb-1">{cliente.nombre}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-lg opacity-90">Cierre {periodo.label}</p>
              <PeriodoCompletenessBadge status={completenessStatus} isAdmin={isAdmin} />
            </div>
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <span className="text-xs uppercase opacity-75">Comparativa:</span>
              {competidores.map((c) => (
                <EntidadChip
                  key={c.nombCorreg}
                  nombCorreg={c.nombCorreg}
                  labelCorto={c.labelCorto}
                  color={c.color}
                  esPropio={c.esPropio}
                  onColorChange={(hex) => setColorForEntity(c.nombCorreg, hex)}
                />
              ))}
              {colorOverrides.size > 0 && (
                <button
                  type="button"
                  onClick={resetAllColors}
                  className="text-[10px] uppercase tracking-wider text-white/70 hover:text-white inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                  title="Restaurar colores por defecto de todas las entidades"
                >
                  <Paintbrush className="w-3 h-3" />
                  Reset colores
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0 no-print">
            <button
              type="button"
              onClick={() => void onExport()}
              disabled={exportando}
              title="Prepara el PDF completo (abre todas las secciones y espera a que carguen antes de imprimir)"
              className="h-9 px-4 bg-white text-slate-900 hover:bg-slate-100 text-sm font-medium rounded transition-colors inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileText className="w-4 h-4" />
              {exportando
                ? (printProgress ?? "Preparando…")
                : "Descargar PDF"}
            </button>
            <Link
              href={"/dashboard/manual/informe" as never}
              className="h-8 px-3 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5 justify-center border border-white/20"
              title="Manual del usuario — 5 minutos"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Cómo usar el Benchmark
            </Link>
          </div>
        </div>
      </header>

      {/* Banner plan (V167) — solo cuando el server marca planLimited=true.
          Fuera del <header> para que no se imprima en el PDF (no-print).
          Copy comercial en lugar de tecnico — invita a subir sin culpar al user. */}
      {planLimited && (
        <div className="no-print mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Tu plan actual permite hasta {planMaxPeers} competidor
              {planMaxPeers === 1 ? "" : "es"} en la comparativa
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Estamos mostrando los primeros {planMaxPeers} del sistema.{" "}
              <Link
                href={"/#planes" as never}
                className="font-semibold underline hover:text-amber-950"
              >
                Sube de plan para comparar hasta 10 entidades.
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* ============ SELECTORES ============ */}
      <Suspense fallback={<div className="h-12" />}>
        <SelectoresToolbarConTema
          periodoActual={periodo.codigo}
          peerGroupActual={competidores.map((c) => c.nombCorreg)}
          entidadPropia={cliente.entidadPropia}
          coloresActuales={new Map(competidores.map((c) => [c.nombCorreg, c.color]))}
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
        periodo={periodo.codigo}
        clienteSlug={cliente.slug}
        entidadPropia={cliente.entidadPropia}
        peerGroup={competidores.map((c) => c.nombCorreg)}
        waterfallYoY={margenNetoWaterfall}
        waterfallVsDic={margenNetoWaterfallVsDic}
        periodoLabelYoY={periodoComparativo.label}
        periodoLabelVsDic={periodoDicPrev.label}
        insightsAllowed={insightsAllowed}
      />

      {/* ============ CALIDAD DE CARTERA — BUBBLE 2x2 riesgo vs cobertura ============ */}
      <SeccionCalidadCartera
        data={data.calidadCartera}
        competidores={competidores}
        clienteSlug={cliente.slug}
        entidadPropia={cliente.entidadPropia}
        periodo={periodo.codigo}
        periodoLabel={periodoLabel}
        publicacionesAllowed={publicacionesAllowed}
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
          colorOverrides={colorOverrides}
          labelCortoToNombCorreg={
            new Map(competidores.map((c) => [c.labelCorto, c.nombCorreg]))
          }
          clienteSlug={cliente.slug}
          entidadPropia={cliente.entidadPropia}
          printMode={printMode}
        />
      </div>

      {/* ============ FOOTER (solo pantalla) ============ */}
      <footer className="border-t border-slate-200 pt-4 pb-8 text-center screen-only">
        <p className="text-xs text-slate-500">
          Fuente: regulador peruano · Benchmark generado por Aibenchef · {new Date().toLocaleDateString("es-PE", { dateStyle: "long" })}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          Los KPIs marcados como "—" requieren datasets adicionales (Oficinas, Personal, Clientes, Mora) aun no ingeridos. Ver docs/ROADMAP.md Fase 1.
        </p>
      </footer>

      {/* ============ FOOTER PDF (solo print) ============ */}
      <PrintFooter clienteNombre={cliente.nombre} periodoLabel={periodo.label} />
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
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800">
          <span className="w-1 h-5 rounded-full bg-brand-500" />
          Cuadro Resumen
        </h2>
        <PerfLegend />
      </div>
      {/* overflow-clip (no overflow-hidden) preserva rounded-lg al mismo
          tiempo que NO crea scroll container — condicion necesaria para
          que position:sticky del thead funcione con el scroll del document
          (no del container). Requiere Chrome 90+/FF 81+/Safari 16+. */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-clip mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* sticky top-14 = 56px offset del navbar del dashboard
                (h-14 sticky z-40). z-20 queda debajo del navbar (z-40)
                pero por encima de las filas de tbody. shadow al bottom
                para separacion visual cuando esta "pegado". */}
            <thead className="sticky top-14 z-20 bg-[#FFC000] border-b-2 border-slate-900/30 shadow-md">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-900 min-w-[260px]" />
                {competidores.map((c) => (
                  <th
                    key={c}
                    className={`px-4 py-3 text-right text-xs uppercase tracking-wider whitespace-nowrap transition-colors ${
                      c === clientePropio
                        ? "bg-slate-900 text-[#FFC000] font-bold"
                        : "text-slate-900 font-semibold hover:bg-slate-900/10"
                    }`}
                  >
                    {c === clientePropio && (
                      <span className="inline-block w-2 h-2 rounded-full bg-[#FFC000] mr-2 align-middle shadow-sm shadow-[#FFC000]/60" />
                    )}
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
      <tr className="bg-slate-50 border-t border-b border-slate-200">
        <td
          colSpan={competidores.length + 1}
          className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-700"
        >
          <span className="inline-flex items-center gap-2">
            <span className="w-1 h-3.5 rounded-full bg-brand-500" />
            {label}
          </span>
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
                <span className="ml-1.5 inline-flex items-center align-middle">
                  <FormulaPopover
                    titulo={k.nombre}
                    contenido={k.tooltip}
                    iconoColor="text-slate-400"
                    stopPropagation={false}
                  />
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
                      ? "bg-amber-50 font-semibold text-slate-900"
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
      <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-3">
        <span className="w-1 h-5 rounded-full bg-brand-500" />
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
            <thead className="bg-[#FFC000] border-b-2 border-slate-900/30">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-900 min-w-[260px]">
                  Componente
                </th>
                {competidores.map((c) => (
                  <th
                    key={c}
                    className={`px-4 py-3 text-right text-xs uppercase tracking-wider whitespace-nowrap transition-colors ${
                      c === clientePropio
                        ? "bg-slate-900 text-[#FFC000] font-bold"
                        : "text-slate-900 font-semibold hover:bg-slate-900/10"
                    }`}
                  >
                    {c === clientePropio && (
                      <span className="inline-block w-2 h-2 rounded-full bg-[#FFC000] mr-2 align-middle shadow-sm shadow-[#FFC000]/60" />
                    )}
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
                            esPropio ? "bg-amber-50" : ""
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
  periodo,
  clienteSlug,
  entidadPropia,
  peerGroup,
  waterfallYoY,
  waterfallVsDic,
  periodoLabelYoY,
  periodoLabelVsDic,
  insightsAllowed,
}: {
  data: BubblePoint[];
  competidores: Competidor[];
  comentario: string;
  comparativoLabel: string;
  periodo: number;
  clienteSlug: string;
  entidadPropia: string;
  peerGroup: string[];
  waterfallYoY: WaterfallData[];
  waterfallVsDic: WaterfallData[];
  periodoLabelYoY: string;
  periodoLabelVsDic: string;
  insightsAllowed: boolean;
}) {
  if (data.length === 0) {
    return (
      <section>
        <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-3"><span className="w-1 h-5 rounded-full bg-brand-500" />
          Analisis Margen Neto — {comparativoLabel}
        </h2>
        <EmptyBox titulo="Sin datos para el bubble chart" texto="Se requieren datos de Punto de Equilibrio del periodo actual y del mismo mes del año anterior." />
      </section>
    );
  }

  const scatterDataRaw = data.map((d) => {
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

  const xMin = Math.min(...scatterDataRaw.map((d) => d.x)) - 0.5;
  const xMax = Math.max(...scatterDataRaw.map((d) => d.x)) + 0.5;
  const yMin = Math.min(...scatterDataRaw.map((d) => d.y)) - 0.5;
  const yMax = Math.max(...scatterDataRaw.map((d) => d.y)) + 0.5;

  // Anti-overlap de labels: si una burbuja tiene VECINOS con X cercano y
  // Y MAYOR (arriba en el chart), su label default 'top' se solaparia con
  // la burbuja de arriba -> lo movemos a 'bottom'. Umbral: 20% del rango X
  // (aprox 1 diametro de burbuja de tamaño medio en la mayoria de charts).
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const xThreshold = xRange * 0.2;
  const yThreshold = yRange * 0.25;
  const scatterData: (typeof scatterDataRaw[number] & { labelSide: "top" | "bottom" })[] =
    scatterDataRaw.map((d) => {
      const tieneVecinoArriba = scatterDataRaw.some((other) => {
        if (other === d) return false;
        return (
          Math.abs(other.x - d.x) < xThreshold &&
          other.y > d.y &&
          other.y - d.y < yThreshold
        );
      });
      return { ...d, labelSide: tieneVecinoArriba ? "bottom" : "top" };
    });

  return (
    <section>
      <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-3"><span className="w-1 h-5 rounded-full bg-brand-500" />
        Analisis Margen Neto — {comparativoLabel}
      </h2>
      <div className="flex flex-col gap-4 mt-4">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
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
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; size?: number; payload?: BubbleChartPayload }) => {
                    const { cx, cy, size, payload } = props;
                    if (cx == null || cy == null || !payload) return <g />;
                    // size viene del ZAxis range (200..1500); es AREA en px^2.
                    // Convertir a radio: r = sqrt(area/PI).
                    const area = typeof size === "number" && size > 0 ? size : 600;
                    const r = Math.sqrt(area / Math.PI);
                    // Placement del label: 'top' pone arriba (default),
                    // 'bottom' abajo — computado en scatterData para evitar
                    // solapes con burbujas vecinas. Offset dinamico por radio
                    // + margen fijo (8px) para respirar de la burbuja.
                    const labelOffset = r + 10;
                    const labelY =
                      payload.labelSide === "bottom"
                        ? cy + labelOffset + 4 // +4 para compensar baseline del text
                        : cy - labelOffset;
                    const labelText = payload.label;
                    // Ancho estimado del pill: 5.5px por char + padding.
                    // Aproximado — SVG no mide sin render. Suficiente para
                    // pill que contenga el texto en el 99% de casos.
                    const pillW = labelText.length * 5.5 + 12;
                    const pillH = 16;
                    const pillY = labelY - pillH + 4;
                    return (
                      <g>
                        {/* halo sutil detras de la burbuja */}
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
                        {/* Pill blanco de fondo detras del label — asegura
                            legibilidad total incluso si el label queda sobre
                            otra burbuja o linea del grid. */}
                        <rect
                          x={cx - pillW / 2}
                          y={pillY}
                          width={pillW}
                          height={pillH}
                          rx={pillH / 2}
                          ry={pillH / 2}
                          fill="#ffffff"
                          fillOpacity={0.92}
                          stroke={payload.color}
                          strokeWidth={1}
                          strokeOpacity={0.35}
                        />
                        <text
                          x={cx}
                          y={labelY}
                          textAnchor="middle"
                          className="text-[10px] font-semibold"
                          fill="#0f172a"
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-2 justify-center print:hidden">
            {competidores.map((c) => (
              <span key={c.nombCorreg} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                {c.labelCorto}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-3 w-full">
          {insightsAllowed ? (
            <ReportInsights
              periodo={periodo}
              seccion="margen_neto"
              clienteSlug={clienteSlug}
              entidadPropia={entidadPropia}
              peerGroup={peerGroup}
              contexto={{
                bubbles: scatterData.map((d) => ({
                  entidad: d.label,
                  deltaPe: d.x,
                  deltaRend: d.y,
                  margenNetoActual: d.margenNeto,
                })),
                // Cascada por competidor — para que el LLM pueda decir
                // "el margen de X subio +40bps: +25 de rendimiento, -15 de
                // provisiones, +30 de costos operativos".
                waterfallYoY: {
                  periodoBaseLabel: periodoLabelYoY,
                  periodoFinalLabel: comparativoLabel,
                  series: waterfallYoY.map((w) => ({
                    entidad: w.competidor,
                    basePct: w.base,
                    finalPct: w.final,
                    totalBps: w.totalBps,
                    componentes: w.componentes,
                  })),
                },
                waterfallVsDic: {
                  periodoBaseLabel: periodoLabelVsDic,
                  periodoFinalLabel: comparativoLabel,
                  series: waterfallVsDic.map((w) => ({
                    entidad: w.competidor,
                    basePct: w.base,
                    finalPct: w.final,
                    totalBps: w.totalBps,
                    componentes: w.componentes,
                  })),
                },
              }}
            />
          ) : (
            <InsightsUpgradeTeaser />
          )}
          {comentario ? <ComentarioBox texto={comentario} /> : null}
        </div>
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
        <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-3"><span className="w-1 h-5 rounded-full bg-brand-500" />
          Margen Neto — Desviaciones en bps
        </h2>
        <EmptyBox titulo="Sin datos para el waterfall" texto="Se requieren datos del Punto de Equilibrio para el período actual y el comparativo." />
      </section>
    );
  }

  return (
    <section>
      <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-3"><span className="w-1 h-5 rounded-full bg-brand-500" />
        Margen Neto — Desviaciones en bps ({comparativoLabel})
      </h2>
      <p className="text-xs text-slate-500 mt-2 px-2">
        <strong>bps</strong> = <em>basis points</em> o puntos b&aacute;sicos. 1 bps = 0.01% =
        1/100 de punto porcentual. As&iacute; un cambio de 100 bps equivale a 1 pp (punto porcentual).
      </p>
      <div className="flex flex-col gap-4 mt-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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
        {comentario ? <ComentarioBox texto={comentario} /> : null}
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
  coloresActuales: Map<string, string>;
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
import type { InsightSeccion } from "@/lib/domains/insights";

const ACCORDION_SECTIONS: Array<{
  metric: AccordionMetric;
  titulo: string;
  subtitulo: string;
  formatoValor: "numero" | "pct" | "moneda_mm";
  /** Si esta definido, habilita el panel de insights AI en esa seccion. */
  insightsSeccion?: InsightSeccion;
  /** Tooltip largo con explicacion detallada. Se renderiza como ⓘ al lado
   *  del subtitulo. Para metricas con formula compleja (ej. venta de cartera). */
  tooltip?: string;
}> = [
  { metric: "carteraBruta",    titulo: "CARTERA BRUTA",                                    subtitulo: "Saldo de Cartera por entidad (MM S/)",                          formatoValor: "moneda_mm", insightsSeccion: "cartera_bruta" },
  { metric: "oficinas",        titulo: "N° DE OFICINAS",                                   subtitulo: "Tendencia ultimos 5 periodos",                                  formatoValor: "numero"    },
  { metric: "personal",        titulo: "N° DE PERSONAL",                                   subtitulo: "Tendencia ultimos 5 periodos",                                  formatoValor: "numero"    },
  { metric: "clientes",        titulo: "N° DE CLIENTES DE CRÉDITO (Miles)",                subtitulo: "Tendencia ultimos 5 periodos",                                  formatoValor: "numero"    },
  { metric: "rendimiento",     titulo: "RENDIMIENTO DE CARTERA",                           subtitulo: "Anualizado (últimos 12 meses)",                                                formatoValor: "pct"       },
  { metric: "costoFondeo",     titulo: "COSTO DE FONDEO",                                  subtitulo: "Anualizado (últimos 12 meses)",                                                formatoValor: "pct"       },
  { metric: "provisiones",     titulo: "COSTO DE PROVISIONES",                             subtitulo: "Gasto Provisiones / Cartera Bruta Prom",                        formatoValor: "pct"       },
  { metric: "eficiencia",      titulo: "EFICIENCIA — Gastos Op / Margen Bruto",            subtitulo: "Anualizado (últimos 12 meses)",                                                formatoValor: "pct"       },
  { metric: "gastosPersonal",  titulo: "GASTOS DE PERSONAL / Margen Bruto",                subtitulo: "Anualizado (últimos 12 meses)",                                                formatoValor: "pct"       },
  { metric: "gastosGenerales", titulo: "GASTOS GENERALES / Margen Bruto",                  subtitulo: "Anualizado (últimos 12 meses)",                                                formatoValor: "pct"       },
  { metric: "ingresos",        titulo: "INGRESOS FINANCIEROS",                             subtitulo: "Anualizado (últimos 12 meses) — MM S/",                                        formatoValor: "moneda_mm" },
  { metric: "gastos",          titulo: "GASTOS FINANCIEROS",                               subtitulo: "Anualizado (últimos 12 meses) — MM S/",                                        formatoValor: "moneda_mm" },
  { metric: "margenBruto",     titulo: "MARGEN FINANCIERO BRUTO",                          subtitulo: "(Ingresos − Gastos) Financieros, últimos 12 meses",             formatoValor: "moneda_mm" },
  { metric: "margenNeto",      titulo: "MARGEN FINANCIERO NETO",                           subtitulo: "Margen Bruto + INOF Neto (últimos 12 meses)",                   formatoValor: "moneda_mm" },
  { metric: "utilidad",        titulo: "RENTABILIDAD — Utilidad Neta",                     subtitulo: "Anualizada (últimos 12 meses) — MM S/",                         formatoValor: "moneda_mm" },
  { metric: "roe",             titulo: "RENTABILIDAD — % ROE",                             subtitulo: "Utilidad 12 meses / Patrimonio promedio 12m",                   formatoValor: "pct"       },
  { metric: "roa",             titulo: "RENTABILIDAD — % ROA",                             subtitulo: "Utilidad 12 meses / Activos promedio 12m",                      formatoValor: "pct"       },
  // Bloque CALIDAD DE CARTERA — ordenado de menor a mayor granularidad
  // 1) Mora basica oficial SBS (campo de validacion, sin castigos ni venta)
  // 2) CAR = mora + refi (siguiente nivel de granularidad)
  // 3) Mora Global = CAR + castigos 12m (limpieza interna)
  // 4) Mora Global con V/C = anterior + venta cartera 12m (limpieza total)
  // 5) Cobertura CAR
  { metric: "atrasada",        titulo: "CALIDAD DE CARTERA — % Créditos Atrasados",        subtitulo: "Cartera Atrasada / Cartera Bruta (Créditos Directos)",          formatoValor: "pct",
    tooltip:
      "Fórmula: Cartera Atrasada / Cartera Bruta." +
      "\n\n" +
      "Es la métrica que publica SBS en el Reporte de Indicadores mensual. Sirve como campo de validación — " +
      "el valor debe coincidir con lo que SBS publica.",
  },
  { metric: "car",             titulo: "CALIDAD DE CARTERA — % Cartera de Alto Riesgo",    subtitulo: "(Atrasada + Refinanciada) / Cartera Bruta",                     formatoValor: "pct"       },
  { metric: "mora",            titulo: "CALIDAD DE CARTERA — % Mora Global (con castigos)", subtitulo: "(Atrasada + Refinanciada + Castigos 12m) / Cartera Bruta",     formatoValor: "pct",       insightsSeccion: "mora_global",
    tooltip:
      "Fórmula: (Atrasada + Refinanciada + Castigos últimos 12 meses) / Cartera Bruta." +
      "\n\n" +
      "Añade los castigos internos al CAR — refleja mora que la entidad ya reconoció como pérdida, aunque " +
      "salió del balance. Diferencia grande vs mora básica = limpieza agresiva de portfolio.",
  },
  { metric: "moraVc",          titulo: "CALIDAD DE CARTERA — % Mora Global (con V/C)",     subtitulo: "Incluye venta de cartera 12m (aproximada) en el numerador",     formatoValor: "pct",
    tooltip:
      "Fórmula: (Atrasada + Refinanciada + Castigos 12m + Venta Cartera 12m) / Cartera Bruta." +
      "\n\n" +
      "Es la métrica más honesta de calidad histórica — suma toda la mora reconocida: balance actual + " +
      "castigos + venta a terceros." +
      "\n\n" +
      "Cómo se aproxima la Venta de Cartera del mes (SBS no la publica directa):" +
      "\n" +
      "  Δ = (Prov previa − Prov actual) + Castigo − Gasto Provisión" +
      "\n" +
      "  Venta ≈ |Δ|  si Δ < 0, sino 0" +
      "\n" +
      "  Venta 12M = suma de los últimos 12 meses.",
  },
  { metric: "cobCar",          titulo: "COBERTURA CARTERA ALTO RIESGO",                    subtitulo: "Provisiones / Cartera Alto Riesgo",                             formatoValor: "pct"       },
];

function SectionsAccordion({
  periodo,
  peerGroup,
  colorOverrides,
  labelCortoToNombCorreg,
  clienteSlug,
  entidadPropia,
  printMode = false,
}: {
  periodo: number;
  peerGroup: string[];
  /** Map<nombCorreg, hex>. Cambios se aplican EN VIVO a todas las secciones
   *  sin necesidad de refetch — cada acordeon re-pinta las series localmente. */
  colorOverrides: Map<string, string>;
  /** Map labelCorto -> nombCorreg. Necesario porque series.entidad es labelCorto
   *  (puede diferir de nombCorreg si config.peer_group.label_corto esta seteado),
   *  pero colorOverrides usa nombCorreg como key (canonical). */
  labelCortoToNombCorreg: Map<string, string>;
  /** Contexto para insights AI en secciones habilitadas via insightsSeccion. */
  clienteSlug: string;
  entidadPropia: string;
  /** Cuando true, todos los accordions se auto-abren y fetchan (para PDF export). */
  printMode?: boolean;
}) {
  return (
    <>
      {ACCORDION_SECTIONS.map((s) => (
        <SeccionHistoricoAccordion
          key={s.metric}
          metric={s.metric}
          titulo={s.titulo}
          subtitulo={s.subtitulo}
          tooltip={s.tooltip}
          formatoValor={s.formatoValor}
          periodo={periodo}
          peerGroup={peerGroup}
          colorOverrides={colorOverrides}
          labelCortoToNombCorreg={labelCortoToNombCorreg}
          insightsSeccion={s.insightsSeccion}
          clienteSlug={clienteSlug}
          entidadPropia={entidadPropia}
          printMode={printMode}
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
  onColorChange,
}: {
  nombCorreg: string;
  labelCorto: string;
  color: string;
  esPropio: boolean;
  /**
   * Callback que actualiza el estado client-side de colorOverrides en el padre.
   * hex = string aplica color; hex = null resetea al default del server.
   */
  onColorChange: (hex: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Estilos diferenciados:
  // - esPropio: fondo blanco solido con texto oscuro (visual destacado)
  //   pero igual clickable para customizar color (afecta charts/headers)
  // - competidor: fondo semi-transparente con border-left del color
  const chipStyle = esPropio
    ? {
        backgroundColor: "#ffffff",
        color: "#0f172a",
        fontWeight: 600,
        borderLeft: `3px solid ${color}`,
      }
    : {
        borderLeft: `3px solid ${color}`,
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
          currentColor={color}
          triggerRef={triggerRef}
          onColorChange={onColorChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Teaser cuando el plan del user no incluye insights AI. Placeholder elegante
 * en el lugar donde iria ReportInsights, invitando al upgrade sin gritar.
 */
function InsightsUpgradeTeaser() {
  return (
    <div className="no-print rounded-lg border border-dashed border-brand-200 bg-gradient-to-br from-brand-50/40 to-indigo-50/40 px-4 py-3 flex items-start gap-3">
      <span className="mt-0.5 inline-flex w-7 h-7 rounded-md bg-brand-100 items-center justify-center flex-shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-brand-700" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">
          Insights AI disponibles en Pro
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          Análisis automático de cada sección con bullets accionables generados
          por IA sobre tu peer group.{" "}
          <Link
            href={"/#planes" as never}
            className="font-semibold text-brand-700 hover:text-brand-800 underline"
          >
            Ver planes
          </Link>
        </p>
      </div>
    </div>
  );
}
