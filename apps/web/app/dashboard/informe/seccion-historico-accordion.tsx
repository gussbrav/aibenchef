"use client";

/**
 * Accordion lazy-load para secciones historicas del Benchmark.
 *
 * UX:
 *  - Por default COLAPSADO — solo se ve el header (titulo + subtitulo + chevron).
 *  - Click en el header -> se expande. Si no hay data cargada, dispara fetch
 *    a /api/v1/informe/historico?metric=X. Mientras llega, muestra un
 *    skeleton elegante (no spinner aburrido).
 *  - Cached: si el usuario colapsa y re-expande, la data ya esta en memoria
 *    y aparece instantanea.
 *
 * Asi la pagina principal carga rapido (sin queries historicas en SSR) y
 * el usuario decide que profundizar. Cada seccion = 1 query indep ~ 200-800ms.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { HistoricoEntidadSerie } from "@/lib/domains/informe/types";
import { SeccionHistoricoComparativo } from "./seccion-historico-comparativo";

export type AccordionMetric =
  | "oficinas" | "personal" | "clientes"
  | "carteraBruta" | "cobCar"
  | "mora" | "moraVc" | "atrasada" | "car"
  | "rendimiento" | "costoFondeo" | "provisiones"
  | "eficiencia" | "gastosPersonal" | "gastosGenerales"
  | "utilidad" | "roe" | "roa"
  | "ingresos" | "gastos" | "margenBruto" | "margenNeto";

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; series: HistoricoEntidadSerie[] }
  | { status: "error"; message: string };

export function SeccionHistoricoAccordion({
  metric,
  titulo,
  subtitulo,
  formatoValor,
  periodo,
  peerGroup,
  colorOverrides,
  labelCortoToNombCorreg,
  consolidar = true,
  defaultOpen = false,
}: {
  metric: AccordionMetric;
  titulo: string;
  subtitulo?: string;
  formatoValor: "numero" | "pct" | "moneda_mm";
  /** Periodo actual del informe (en formato YYYYMM). */
  periodo: number;
  /** Lista de entidades canonicas en el peer group activo. */
  peerGroup: string[];
  /**
   * Map<nombCorreg, hex> con colores override del usuario. Se aplican EN VIVO
   * sobre las series cacheadas — sin refetch — para que el cambio de color
   * en el header propague INSTANT a estos graficos (fix bug Cartera Bruta).
   */
  colorOverrides?: Map<string, string>;
  /** Map labelCorto -> nombCorreg para resolver el override correcto. */
  labelCortoToNombCorreg?: Map<string, string>;
  consolidar?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<FetchState>({ status: "idle" });
  // Track del ultimo peerGroup para invalidar cache si cambia
  const peerKeyRef = useRef<string>(peerGroup.join("|"));

  const fetchData = useCallback(async () => {
    setState({ status: "loading" });
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const params = new URLSearchParams({
        metric,
        periodo: String(periodo),
        peerGroup: peerGroup.join(","),
        consolidar: String(consolidar),
      });
      const url = `/api/v1/informe/historico?${params}`;
      const r = await fetch(url, { signal: controller.signal });
      const json = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
      if (!r.ok || json.error) {
        const msg = json.error?.message ?? `HTTP ${r.status}`;
        setState({ status: "error", message: msg });
        // eslint-disable-next-line no-console
        console.error(`[historico ${metric}] error:`, msg, "URL:", url);
        return;
      }
      const series = (json.data?.series ?? []) as HistoricoEntidadSerie[];
      if (series.length === 0) {
        setState({
          status: "error",
          message: "El endpoint devolvió 0 series. Posible problema de datos para este peer group.",
        });
        return;
      }
      setState({ status: "ok", series });
    } catch (e) {
      const isAbort = (e as { name?: string })?.name === "AbortError";
      const msg = isAbort
        ? "Timeout 15s. Si esta seccion usa mora/cobertura CAR, requiere migracion V128 aplicada. Pedi al equipo aplicar el deploy mas reciente."
        : e instanceof Error
          ? e.message
          : String(e);
      setState({ status: "error", message: msg });
      // eslint-disable-next-line no-console
      console.error(`[historico ${metric}] exception:`, e);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [metric, periodo, peerGroup, consolidar]);

  // Si el peer group cambia, invalidar cache.
  useEffect(() => {
    const key = peerGroup.join("|");
    if (key !== peerKeyRef.current) {
      peerKeyRef.current = key;
      setState({ status: "idle" });
      if (open) void fetchData();
    }
  }, [peerGroup, open, fetchData]);

  // Si esta abierto y no hay data, fetchear.
  useEffect(() => {
    if (open && state.status === "idle") {
      void fetchData();
    }
  }, [open, state.status, fetchData]);

  // Aplica overrides EN VIVO sobre las series cacheadas. Sin esto, los
  // graficos del accordion conservan los colores del fetch original aunque
  // el usuario haya cambiado los colores desde el header (fix bug Cartera Bruta).
  // El series.entidad es labelCorto (puede diferir de nombCorreg si
  // config.peer_group.label_corto esta seteado). Resolvemos primero a
  // nombCorreg via labelCortoToNombCorreg, luego buscamos en colorOverrides.
  // Fallback: intentar match directo por labelCorto (caso default sin label_corto).
  const seriesConOverrides = useMemo(() => {
    if (state.status !== "ok") return [];
    if (!colorOverrides || colorOverrides.size === 0) return state.series;
    return state.series.map((s) => {
      const nombCorreg = labelCortoToNombCorreg?.get(s.entidad) ?? s.entidad;
      const override =
        colorOverrides.get(nombCorreg) ?? colorOverrides.get(s.entidad);
      return override ? { ...s, color: override } : s;
    });
  }, [state, colorOverrides, labelCortoToNombCorreg]);

  const toggle = () => setOpen((v) => !v);

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "w-full px-5 py-4 flex items-center justify-between gap-4 text-left transition-colors",
          "bg-gradient-to-r from-brand-900 to-brand-700 text-white hover:from-brand-800 hover:to-brand-600",
        )}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-wide truncate">{titulo}</h2>
          {subtitulo && (
            <p className="text-[11px] text-white/75 mt-0.5 truncate">{subtitulo}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {state.status === "ok" && (
            <span className="text-[10px] uppercase tracking-wider bg-white/15 px-2 py-0.5 rounded">
              {state.series.length} entidades
            </span>
          )}
          {open ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-200">
          {state.status === "loading" && <Skeleton entidades={peerGroup.length} />}
          {state.status === "error" && (
            <div className="p-6 flex items-start gap-3 text-sm text-rose-700">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">No se pudo cargar esta sección</p>
                <p className="text-xs mt-0.5">{state.message}</p>
                <button
                  type="button"
                  onClick={() => void fetchData()}
                  className="mt-2 text-xs text-rose-800 underline hover:text-rose-900"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}
          {state.status === "ok" && (
            <SeccionHistoricoComparativo
              titulo={titulo}
              subtitulo={subtitulo}
              series={seriesConOverrides}
              periodoBaseLabel={state.series[0]?.serie[0]?.periodoLabel}
              periodoActualLabel={
                state.series[0]?.serie[state.series[0]?.serie.length - 1]
                  ?.periodoLabel
              }
              formatoValor={formatoValor}
              noWrapper
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Skeleton mientras carga la data. Imita el layout del componente real
 * (panel izquierdo con barras + grid derecho de mini-charts) para evitar
 * "salto" visual cuando llega la data.
 */
function Skeleton({ entidades }: { entidades: number }) {
  const n = Math.min(entidades, 6);
  return (
    <div className="p-5 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 animate-pulse">
      <div className="space-y-3">
        <div className="h-5 w-32 bg-slate-200 rounded" />
        <div className="h-3 w-44 bg-slate-100 rounded" />
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-3 w-12 bg-slate-100 rounded" />
            </div>
            <div className="h-3 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
      <div>
        <div className="h-3 w-32 bg-slate-100 rounded mx-auto mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: n }).map((_, i) => (
            <div
              key={i}
              className="border border-slate-100 rounded p-2 h-28 flex flex-col gap-2"
            >
              <div className="h-3 w-20 bg-slate-200 rounded mx-auto" />
              <div className="flex-1 flex items-end gap-1">
                {Array.from({ length: 5 }).map((__, j) => (
                  <div
                    key={j}
                    className="flex-1 bg-slate-100 rounded-t"
                    style={{ height: `${30 + Math.random() * 60}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
