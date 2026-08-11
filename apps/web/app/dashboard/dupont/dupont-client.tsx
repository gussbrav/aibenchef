"use client";

/**
 * DupontClient — vista principal del Analisis DuPont.
 *
 * Layout: replica exacta del PDF de referencia (Presentacion DuPont Caja
 * Arequipa). 4 secciones verticales scrolleables, cada una con sidebar
 * de narrativa auto-generada a la izquierda + bar charts agrupados a la
 * derecha (recharts BarChart).
 *
 * Selectores draft-and-apply (mismo patron que /punto-equilibrio):
 * los cambios en entidades/periodos se acumulan en state local hasta que
 * el usuario aplique via "Aplicar filtros" (evita re-fetches en cada tick).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import {
  Sparkles, Users, Calendar, X, Plus, Loader2, Paintbrush, Wand2, GripVertical, Search, Check, ChevronDown,
} from "lucide-react";

import type { DupontData, DupontRow, DupontInsights } from "@/lib/domains/dupont";
import type { EntidadDisponible } from "@/lib/domains/informe";
import { ColorPickerPopover } from "@/app/dashboard/informe/color-picker-popover";
import { RenombresToggle } from "@/components/ui";

// COOKIE para persistir filtros aplicados. Sobrevive cambio de tab
// (Punto Equilibrio → DuPont) porque el Link del nav no preserva query
// params.
//
// IMPORTANTE: se eligio COOKIE en lugar de localStorage a proposito.
// La cookie viaja al server automaticamente, entonces page.tsx puede
// leerla en el primer render SSR y devolver la vista con los filters
// correctos DESDE EL PRIMER FRAME. Sin cookie (localStorage-only) el
// server renderiza con defaults, el client hydrata igual, y solo tras
// un useEffect + navegacion aparecen los custom colors → flash visible.
//
// Trade-off: cookie tiene limite de 4KB. Nuestro snapshot es ~1KB
// (10 entidades × 30 chars + 6 periodos + 10 colors × 20 chars).
const COOKIE_KEY_DUPONT_FILTERS = "dupont_filters_v1";
const COOKIE_MAX_AGE_DAYS = 30;

type DupontFiltersSnapshot = {
  entidades: string[];      // orden importa (drag & drop)
  periodos: number[];
  colors: Array<[string, string]>; // Map serializado como array de [name, hex]
  consolidar?: boolean;     // fusion de renombres historicos (opt-in)
};

// Helper para escribir cookie desde el client. Path=/ para que aplique
// a toda la app. SameSite=Lax para compat con la mayoria de flujos.
function writeCookie(name: string, value: string, maxAgeDays: number): void {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(value);
  const maxAge = maxAgeDays * 24 * 60 * 60;
  document.cookie = `${name}=${encoded}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

// Helper para borrar cookie (boton 'Restablecer defaults')
function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

// ============================================================================
// Formatters
// ============================================================================

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtPeriodoLabel(codigo: number): string {
  const anio = Math.floor(codigo / 100);
  const mes = codigo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"}-${String(anio).slice(-2)}`;
}

// Meses entre dos periodos YYYYMM. Usado para detectar entidades con
// data obsoleta (>3 meses de gap = probable rename historico).
function gapEnMeses(desde: number, hasta: number): number {
  const aDesde = Math.floor(desde / 100);
  const mDesde = desde % 100;
  const aHasta = Math.floor(hasta / 100);
  const mHasta = hasta % 100;
  return (aHasta - aDesde) * 12 + (mHasta - mDesde);
}

// ============================================================================
// Componente raiz
// ============================================================================

export function DupontClient({
  data,
  periodosDisponibles,
  entidadesDisponibles,
  consolidar,
  initialInsights = null,
  initialInsightsModel = null,
}: {
  data: DupontData;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
  consolidar: boolean;
  /** Insights pre-cargados desde el cache DB (server-side). Si vienen,
   * el hook useNarrativaIA los usa como initial state y salta el fetch
   * inicial — elimina el "Generando..." al cambiar de tab. */
  initialInsights?: DupontInsights | null;
  initialInsightsModel?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Server state (initial) — lo que actualmente muestra la vista.
  const initialEntidades = useMemo(
    () => data.entidades.map((e) => e.nombCorreg),
    [data.entidades],
  );
  const initialPeriodos = useMemo(
    () => data.periodos.map((p) => p.codigo),
    [data.periodos],
  );
  const initialColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data.entidades) m.set(e.nombCorreg, e.color);
    return m;
  }, [data.entidades]);

  // Draft state — TODOS los cambios (entidades, periodos, orden, colores)
  // se acumulan aca hasta que el user presiona 'Aplicar filtros'.
  // Colores son excepcion visual: se muestran EN VIVO en los charts
  // (preview instantaneo del cambio) pero solo se persisten en URL/DB
  // al aplicar filtros.
  const [draftEntidades, setDraftEntidades] = useState<string[]>(initialEntidades);
  const [draftPeriodos, setDraftPeriodos] = useState<number[]>(initialPeriodos);
  const [draftColors, setDraftColors] = useState<Map<string, string>>(initialColors);
  const [draftConsolidar, setDraftConsolidar] = useState<boolean>(consolidar);

  // Sync draft <- initial cuando data cambia por navegacion server-side
  // (post applyFilters). Sin esto, chips nuevos aparecerian sin color y
  // el dirty check quedaria inconsistente.
  useEffect(() => {
    setDraftEntidades(initialEntidades);
  }, [initialEntidades]);
  useEffect(() => {
    setDraftPeriodos(initialPeriodos);
  }, [initialPeriodos]);
  useEffect(() => {
    setDraftColors(initialColors);
  }, [initialColors]);
  useEffect(() => {
    setDraftConsolidar(consolidar);
  }, [consolidar]);

  // NO hay useEffect de restore aca. La cookie ya viajo al server via
  // page.tsx en el SSR — si habia snapshot, el server ya renderizo con
  // los filters correctos. Cero flash SSR→hydration.

  // Dirty check: hay cambios pendientes sin aplicar?
  const dirty = useMemo(() => {
    if (draftEntidades.length !== initialEntidades.length) return true;
    if (draftPeriodos.length !== initialPeriodos.length) return true;
    for (let i = 0; i < draftEntidades.length; i++) {
      if (draftEntidades[i] !== initialEntidades[i]) return true;
    }
    for (let i = 0; i < draftPeriodos.length; i++) {
      if (draftPeriodos[i] !== initialPeriodos[i]) return true;
    }
    // Colors dirty — solo entidades que estan en el draft
    for (const n of draftEntidades) {
      const iv = initialColors.get(n);
      const dv = draftColors.get(n);
      if (iv && dv && iv.toLowerCase() !== dv.toLowerCase()) return true;
    }
    if (draftConsolidar !== consolidar) return true;
    return false;
  }, [
    draftEntidades, initialEntidades, draftPeriodos, initialPeriodos,
    draftColors, initialColors, draftConsolidar, consolidar,
  ]);

  // Aplicar filtros — 1 push a la URL con TODOS los cambios juntos +
  // snapshot al localStorage para persistir entre navegaciones.
  const applyFilters = useCallback(() => {
    const params = new URLSearchParams();
    params.set("entidades", draftEntidades.join(","));
    params.set("periodos", draftPeriodos.join(","));
    // consolidar solo va en URL si es true (default es false — URL limpia).
    if (draftConsolidar) params.set("consolidar", "true");
    // Colors: solo los que difieren del server-default (para URL limpia).
    // Si el user reseteó todos los colores, no aparece ?colors= en la URL.
    const overrides: Array<[string, string]> = [];
    for (const n of draftEntidades) {
      const dv = draftColors.get(n);
      const iv = initialColors.get(n);
      // Persistir siempre que haya color en el draft (mas robusto). El
      // server aplica el override; si no override, usa la paleta estable.
      if (dv) overrides.push([n, dv]);
    }
    if (overrides.length > 0) {
      params.set("colors", overrides.map(([n, hex]) => `${n}:${hex.replace(/^#/, "")}`).join(","));
    }

    // Persist snapshot en COOKIE (viaja al server, evita flash SSR).
    const snap: DupontFiltersSnapshot = {
      entidades: draftEntidades,
      periodos: draftPeriodos,
      colors: overrides,
      consolidar: draftConsolidar,
    };
    writeCookie(COOKIE_KEY_DUPONT_FILTERS, JSON.stringify(snap), COOKIE_MAX_AGE_DAYS);

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}` as never, { scroll: false });
    });
  }, [draftEntidades, draftPeriodos, draftColors, draftConsolidar, initialColors, pathname, router]);

  const resetFilters = useCallback(() => {
    setDraftEntidades(initialEntidades);
    setDraftPeriodos(initialPeriodos);
    setDraftColors(initialColors);
    setDraftConsolidar(consolidar);
  }, [initialEntidades, initialPeriodos, initialColors, consolidar]);

  // Restablecer defaults del sistema: borrar cookie + navegar sin params.
  // El server volvera a usar getDefaultPeerGroup('bcp') y los colores
  // estable del peer group base. Utile cuando el user quiere volver al
  // 'estado limpio' despues de mucha experimentacion.
  const restoreSystemDefaults = useCallback(() => {
    deleteCookie(COOKIE_KEY_DUPONT_FILTERS);
    startTransition(() => {
      router.push(pathname as never, { scroll: false });
    });
  }, [pathname, router]);

  // Cambiar color de una entidad → solo update draft (no push URL).
  // Se persiste con el proximo 'Aplicar filtros'.
  const setColorForEntity = useCallback(
    (nombCorreg: string, hex: string | null) => {
      setDraftColors((prev) => {
        const next = new Map(prev);
        if (hex) next.set(nombCorreg, hex);
        else {
          const server = initialColors.get(nombCorreg);
          if (server) next.set(nombCorreg, server);
          else next.delete(nombCorreg);
        }
        return next;
      });
    },
    [initialColors],
  );

  // Reordenar entidades via drag & drop. moveEntidad(from, to) reposiciona
  // en el array y marca dirty. Se aplica visualmente en vivo en el picker
  // y en los charts (via dataConColores).
  const moveEntidad = useCallback((from: string, to: string) => {
    setDraftEntidades((prev) => {
      const fromIdx = prev.indexOf(from);
      const toIdx = prev.indexOf(to);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
  }, []);

  // Data con orden + colores DEL DRAFT aplicados (preview en vivo antes
  // de aplicar filtros). Cuando dirty=false, coincide con la data del
  // server. Cuando dirty=true, muestra como se veria post-apply.
  const dataConColores = useMemo(() => {
    // Reordenar entidades segun draftEntidades
    const entMap = new Map(data.entidades.map((e) => [e.nombCorreg, e]));
    const entOrdered = draftEntidades
      .map((n) => entMap.get(n))
      .filter((e): e is (typeof data.entidades)[number] => !!e)
      .map((e) => ({ ...e, color: draftColors.get(e.nombCorreg) ?? e.color }));
    return { ...data, entidades: entOrdered };
  }, [data, draftEntidades, draftColors]);

  // Indexar filas por (entidad, periodo) para lookup rapido en las secciones
  const rowsIndex = useMemo(() => {
    const m = new Map<string, DupontRow>();
    for (const r of data.filas) {
      m.set(`${r.entidad}|${r.periodo}`, r);
    }
    return m;
  }, [data.filas]);

  // Mapa nombCorreg -> color EN VIVO para pasar al selector (chips coloreados)
  const colorByEnt = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of dataConColores.entidades) m.set(e.nombCorreg, e.color);
    return m;
  }, [dataConColores.entidades]);

  // ============ NARRATIVA IA (Claude) ============
  // Si initialInsights vino del server (cache DB hit), se usa directamente
  // → cero "Generando..." al montar. Solo se dispara fetch si initial=null
  // (cache miss) o si data cambia (nueva combinacion peer+periodos).
  const narrativaIA = useNarrativaIA(data, initialInsights, initialInsightsModel);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 px-4 animate-premium-in">
      {/* ============ HEADER ============ */}
      <header className="rounded-xl text-white p-8 relative bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 shadow-lg">
        <div
          className="absolute inset-0 opacity-40 pointer-events-none rounded-xl"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.06) 0%, transparent 40%)",
          }}
        />
        <div className="relative z-10">
          <p className="text-xs uppercase tracking-[0.2em] opacity-70 mb-3 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
            Análisis Financiero
          </p>
          <h1 className="text-3xl font-bold mb-2">Análisis DuPont</h1>
          <p className="text-sm opacity-90 max-w-3xl">
            Descomposición jerárquica del ROE en factores multiplicativos y aditivos.
            Todos los ratios están anualizados (últimos 12 meses) y normalizados sobre
            el activo promedio del período — excepto ROE (patrimonio) y Apalancamiento (adimensional).
          </p>
        </div>
      </header>

      {/* ============ SELECTORES ============ */}
      <SelectoresBar
        draftEntidades={draftEntidades}
        setDraftEntidades={setDraftEntidades}
        moveEntidad={moveEntidad}
        draftPeriodos={draftPeriodos}
        setDraftPeriodos={setDraftPeriodos}
        draftConsolidar={draftConsolidar}
        setDraftConsolidar={setDraftConsolidar}
        entidadesDisponibles={entidadesDisponibles}
        periodosDisponibles={periodosDisponibles}
        colorByEnt={colorByEnt}
        onColorChange={setColorForEntity}
        dirty={dirty}
        isPending={isPending}
        onApply={applyFilters}
        onReset={resetFilters}
        onRestoreDefaults={restoreSystemDefaults}
      />

      {/* ============ SECCION 1 — ROE = ROA × Apalancamiento ============ */}
      <SeccionDupont
        numero={1}
        seccionKey="roe"
        titulo="ROE = ROA × Apalancamiento"
        subtitulo="Rentabilidad sobre el patrimonio, descompuesta en eficiencia operativa y estructura de capital."
        indicadorPrincipal={{
          label: "ROE (%)",
          getter: (r) => r.roePct,
          formato: "pct",
        }}
        subIndicadores={[
          { label: "ROA (%)", getter: (r) => r.roaPct, formato: "pct" },
          { label: "Activos / Patrimonio", getter: (r) => r.apalancamiento, formato: "num" },
        ]}
        data={dataConColores}
        rowsIndex={rowsIndex}
        narrativaIA={narrativaIA}
      />

      {/* ============ SECCION 2 — ROA descomposicion ============ */}
      <SeccionDupont
        numero={2}
        seccionKey="roa"
        titulo="ROA = Margen Op. Neto + Otros Ingresos + Impuestos"
        subtitulo="Descomposición del retorno sobre activos por naturaleza del resultado."
        indicadorPrincipal={{
          label: "ROA (%)",
          getter: (r) => r.roaPct,
          formato: "pct",
        }}
        subIndicadores={[
          { label: "Margen Oper. Neto (%)", getter: (r) => r.margenOpPct, formato: "pct" },
          { label: "Otros Ingresos Netos (%)", getter: (r) => r.otrosIngPct, formato: "pct" },
          { label: "Impuestos (%)", getter: (r) => r.impuestosPct, formato: "pct" },
        ]}
        data={dataConColores}
        rowsIndex={rowsIndex}
        narrativaIA={narrativaIA}
      />

      {/* ============ SECCION 3 — Margen Op Neto descomposicion ============ */}
      <SeccionDupont
        numero={3}
        seccionKey="mon"
        titulo="Margen Op. Neto = MFB + ISF Netos + Gastos"
        subtitulo="Estructura del margen operativo: qué ingresos y qué gastos lo forman."
        indicadorPrincipal={{
          label: "Margen Oper. Neto (%)",
          getter: (r) => r.margenOpPct,
          formato: "pct",
        }}
        subIndicadores={[
          { label: "Margen Financiero Bruto (%)", getter: (r) => r.mfbPct, formato: "pct" },
          { label: "Ing. por Serv. Fin. Netos (%)", getter: (r) => r.isfnPct, formato: "pct" },
          { label: "Gasto de Provisiones (%)", getter: (r) => r.provisionesPct, formato: "pct" },
          { label: "Gasto de Personal (%)", getter: (r) => r.personalPct, formato: "pct" },
          { label: "Gastos Generales (%)", getter: (r) => r.generalesPct, formato: "pct" },
        ]}
        data={dataConColores}
        rowsIndex={rowsIndex}
        narrativaIA={narrativaIA}
      />

      {/* ============ SECCION 4 — Margen Financiero Bruto descomposicion ============ */}
      <SeccionDupont
        numero={4}
        seccionKey="mfb"
        titulo="MFB = Ingresos Cartera + Inversión − Gastos Financieros"
        subtitulo="El margen financiero bruto viene del spread entre lo que renta la cartera y lo que cuesta el fondeo."
        indicadorPrincipal={{
          label: "Margen Financiero Bruto (%)",
          getter: (r) => r.mfbPct,
          formato: "pct",
        }}
        subIndicadores={[
          { label: "Ingresos de Cartera (%)", getter: (r) => r.ingCarteraPct, formato: "pct" },
          { label: "Ingresos de Inversión (%)", getter: (r) => r.ingInversionPct, formato: "pct" },
          { label: "Gasto Financiero (%)", getter: (r) => r.gastosFinPct, formato: "pct" },
        ]}
        data={dataConColores}
        rowsIndex={rowsIndex}
        narrativaIA={narrativaIA}
      />

      {/* Footer nota metodologica */}
      <div className="text-[11px] text-slate-500 px-2 pb-6">
        <strong>Metodología:</strong> ratios TTM (<em>Trailing Twelve Months</em>
        {" "}— últimos 12 meses móviles, incluye estacionalidad completa) sobre
        activo promedio de los últimos 12 meses. Fuente: Superintendencia de
        Banca, Seguros y AFP (SBS Perú). Convención de signos: los gastos se
        muestran con signo negativo para que se sumen algebraicamente con los
        ingresos y respeten el árbol DuPont clásico (ROE = ROA × Apalancamiento;
        ROA = MON + Otros + Impuestos; etc.).
      </div>
    </div>
  );
}

// ============================================================================
// Selectores bar (draft + apply)
// ============================================================================

function SelectoresBar({
  draftEntidades,
  setDraftEntidades,
  moveEntidad,
  draftPeriodos,
  setDraftPeriodos,
  draftConsolidar,
  setDraftConsolidar,
  entidadesDisponibles,
  periodosDisponibles,
  colorByEnt,
  onColorChange,
  dirty,
  isPending,
  onApply,
  onReset,
  onRestoreDefaults,
}: {
  draftEntidades: string[];
  setDraftEntidades: (v: string[]) => void;
  moveEntidad: (from: string, to: string) => void;
  draftPeriodos: number[];
  setDraftPeriodos: (v: number[]) => void;
  draftConsolidar: boolean;
  setDraftConsolidar: (v: boolean) => void;
  entidadesDisponibles: EntidadDisponible[];
  periodosDisponibles: number[];
  colorByEnt: Map<string, string>;
  onColorChange: (nombCorreg: string, hex: string | null) => void;
  dirty: boolean;
  isPending: boolean;
  onApply: () => void;
  onReset: () => void;
  onRestoreDefaults: () => void;
}) {
  const [entidadModalOpen, setEntidadModalOpen] = useState(false);
  const [draggedEnt, setDraggedEnt] = useState<string | null>(null);
  const [dropTargetEnt, setDropTargetEnt] = useState<string | null>(null);

  // Ultimo periodo con data en el sistema (mayor ultimoPeriodo de todas las
  // entidades). Sirve de referencia para el flag 'obsoleto' — entidades con
  // gap >3 meses vs este maximo probablemente sufrieron rename historico.
  const maxDisponiblePeriodo = useMemo(() => {
    let max = 0;
    for (const e of entidadesDisponibles) if (e.ultimoPeriodo > max) max = e.ultimoPeriodo;
    return max;
  }, [entidadesDisponibles]);

  const removeEntidad = (n: string) => {
    setDraftEntidades(draftEntidades.filter((x) => x !== n));
  };

  const changePeriodo = (idx: number, val: number) => {
    const next = [...draftPeriodos];
    next[idx] = val;
    setDraftPeriodos(next);
  };

  const addPeriodo = () => {
    if (draftPeriodos.length >= 6) return;
    const last = draftPeriodos[draftPeriodos.length - 1] ?? 202412;
    setDraftPeriodos([...draftPeriodos, last]);
  };

  const removePeriodo = (idx: number) => {
    if (draftPeriodos.length <= 1) return;
    setDraftPeriodos(draftPeriodos.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3 flex flex-col gap-3">
      <div className="flex items-start gap-6 flex-wrap">
        {/* Entidades */}
        <div className="flex-1 min-w-[300px]">
          <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5 mb-2">
            <Users className="w-3 h-3" />
            Entidades ({draftEntidades.length})
          </label>
          <div className="flex flex-wrap gap-1.5 items-center">
            {draftEntidades.map((n) => {
              const info = entidadesDisponibles.find((e) => e.nombCorreg === n);
              const gap = info
                ? gapEnMeses(info.ultimoPeriodo, maxDisponiblePeriodo)
                : 0;
              return (
                <EntidadChipConColor
                  key={n}
                  nombCorreg={n}
                  color={colorByEnt.get(n) ?? "#64748b"}
                  ultimoPeriodo={info?.ultimoPeriodo}
                  obsoleto={gap > 3}
                  onColorChange={(hex) => onColorChange(n, hex)}
                  onRemove={() => removeEntidad(n)}
                  draggable
                  isDragging={draggedEnt === n}
                  isDropTarget={dropTargetEnt === n && draggedEnt !== n}
                  onDragStart={() => setDraggedEnt(n)}
                  onDragEnd={() => {
                    setDraggedEnt(null);
                    setDropTargetEnt(null);
                  }}
                  onDragOver={() => {
                    if (draggedEnt && draggedEnt !== n) setDropTargetEnt(n);
                  }}
                  onDragLeave={() => {
                    if (dropTargetEnt === n) setDropTargetEnt(null);
                  }}
                  onDrop={() => {
                    if (draggedEnt && draggedEnt !== n) moveEntidad(draggedEnt, n);
                    setDropTargetEnt(null);
                  }}
                />
              );
            })}
            <button
              type="button"
              onClick={() => setEntidadModalOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border border-dashed border-brand-400 text-brand-700 hover:bg-brand-50"
            >
              <Plus className="w-3 h-3" /> Agregar
            </button>
          </div>
        </div>

        {/* Periodos */}
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1.5 mb-2">
            <Calendar className="w-3 h-3" />
            Períodos ({draftPeriodos.length}) — YYYYMM
          </label>
          <div className="flex flex-wrap gap-1.5 items-center">
            {draftPeriodos.map((p, idx) => (
              <div key={idx} className="inline-flex items-center gap-1">
                <select
                  value={p}
                  onChange={(e) => changePeriodo(idx, Number(e.target.value))}
                  className="text-xs h-8 px-2 rounded border border-slate-300 bg-white tabular-nums"
                >
                  {periodosDisponibles.map((pd) => (
                    <option key={pd} value={pd}>
                      {fmtPeriodoLabel(pd)} ({pd})
                    </option>
                  ))}
                </select>
                {draftPeriodos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePeriodo(idx)}
                    className="p-1 rounded hover:bg-rose-100 hover:text-rose-700"
                    aria-label="Quitar período"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {draftPeriodos.length < 6 && (
              <button
                type="button"
                onClick={addPeriodo}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-dashed border-brand-400 text-brand-700 hover:bg-brand-50 h-8"
              >
                <Plus className="w-3 h-3" /> Agregar período
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Toggle unificado <RenombresToggle> — mismo componente que Benchmark
          y Punto Equilibrio para consistencia UX cross-vista. */}
      <div className="self-start">
        <RenombresToggle value={draftConsolidar} onChange={setDraftConsolidar} />
      </div>

      {/* Barra de accion apply/reset — TODO cambio (entidades, periodos, orden,
          colores, consolidar) se acumula en draft y se persiste con 'Aplicar
          filtros'. Los colores se ven en vivo (preview) para feedback inmediato
          pero solo quedan guardados en URL/cookie al aplicar. */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-[11px] text-slate-500 italic">
          {dirty
            ? "Cambios pendientes (entidades / períodos / orden / colores) — presiona Aplicar para guardar"
            : "Los filtros están sincronizados con la vista"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRestoreDefaults}
            disabled={isPending}
            className="px-3 h-8 text-xs rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Volver al peer group y colores default del sistema (borra tu configuración guardada)"
          >
            Restablecer defaults
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!dirty || isPending}
            className="px-3 h-8 text-xs rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty || isPending}
            className="px-4 h-8 text-xs font-semibold rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            Aplicar filtros
          </button>
        </div>
      </div>

      {entidadModalOpen && (
        <EntidadPicker
          disponibles={entidadesDisponibles}
          seleccionadas={draftEntidades}
          onClose={() => setEntidadModalOpen(false)}
          onToggle={(n) => {
            if (draftEntidades.includes(n)) {
              setDraftEntidades(draftEntidades.filter((x) => x !== n));
            } else {
              if (draftEntidades.length >= 8) return;
              setDraftEntidades([...draftEntidades, n]);
            }
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// EntidadChipConColor — chip con dot clickeable (abre ColorPickerPopover)
// + boton X para quitar. Reutiliza el ColorPickerPopover del /informe para
// consistencia visual y de comportamiento cross-vista.
// ============================================================================

function EntidadChipConColor({
  nombCorreg,
  color,
  ultimoPeriodo,
  obsoleto = false,
  onColorChange,
  onRemove,
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  nombCorreg: string;
  color: string;
  ultimoPeriodo?: number;
  obsoleto?: boolean;
  onColorChange: (hex: string | null) => void;
  onRemove: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const dotRef = useRef<HTMLButtonElement>(null);

  return (
    <span
      draggable={draggable}
      onDragStart={(e) => {
        if (!onDragStart) return;
        e.dataTransfer.effectAllowed = "move";
        // Firefox necesita dataTransfer.setData para arrancar el drag
        e.dataTransfer.setData("text/plain", nombCorreg);
        onDragStart();
      }}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => {
        if (!onDragOver) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDragLeave={() => onDragLeave?.()}
      onDrop={(e) => {
        if (!onDrop) return;
        e.preventDefault();
        onDrop();
      }}
      className={`inline-flex items-center gap-1 pl-0.5 pr-1 py-1 text-xs rounded-full border transition-all ${
        obsoleto
          ? "bg-amber-50 border-amber-200 text-amber-900"
          : "bg-slate-100 border-slate-200 text-slate-700"
      } ${draggable ? "cursor-move select-none" : ""} ${
        isDragging ? "opacity-40" : ""
      } ${isDropTarget ? "ring-2 ring-brand-400 ring-offset-1" : ""}`}
    >
      {draggable && (
        <GripVertical
          className="w-3 h-3 text-slate-400 flex-shrink-0"
          aria-hidden
        />
      )}
      <button
        ref={dotRef}
        type="button"
        onClick={() => setPickerOpen(true)}
        className="w-4 h-4 rounded-full border border-white/60 shadow-sm hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-brand-400 relative group"
        style={{ backgroundColor: color }}
        aria-label={`Cambiar color de ${nombCorreg}`}
        title="Click para cambiar color"
      >
        <Paintbrush className="w-2 h-2 text-white/0 group-hover:text-white/90 absolute inset-0 m-auto" />
      </button>
      <span className="px-1">{nombCorreg}</span>
      {obsoleto && ultimoPeriodo && (
        <span
          className="text-[9px] px-1 py-0.5 rounded bg-amber-200 text-amber-900 font-semibold cursor-help"
          title={`Sin data desde ${fmtPeriodoLabel(ultimoPeriodo)}. Esta entidad probablemente cambió de nombre (rename histórico). Verifica si existe un canónico más reciente para ver la data completa.`}
        >
          ⚠ {fmtPeriodoLabel(ultimoPeriodo)}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded hover:bg-rose-100 hover:text-rose-700"
        aria-label={`Quitar ${nombCorreg}`}
      >
        <X className="w-3 h-3" />
      </button>
      {pickerOpen && (
        <ColorPickerPopover
          nombCorreg={nombCorreg}
          labelCorto={nombCorreg}
          currentColor={color}
          triggerRef={dotRef}
          onColorChange={(hex) => {
            onColorChange(hex);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </span>
  );
}

// ============================================================================
// Modal para elegir entidades (buscable)
// ============================================================================

function EntidadPicker({
  disponibles,
  seleccionadas,
  onClose,
  onToggle,
}: {
  disponibles: EntidadDisponible[];
  seleccionadas: string[];
  onClose: () => void;
  onToggle: (n: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtradas = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    if (!qLower) return disponibles;
    return disponibles.filter((e) => e.nombCorreg.toLowerCase().includes(qLower));
  }, [q, disponibles]);

  // Ultimo periodo REAL disponible en el dataset (max de todos los
  // ultimoPeriodo). Si una entidad tiene ultimo < ese max por >6 meses,
  // probablemente sufrio un rename y su historia continua bajo otro
  // canonico. Mostramos badge de warning para prevenir seleccion "ciega"
  // que devuelva datos sin cobertura al periodo actual del analisis.
  const maxPeriodoDisponible = useMemo(() => {
    let max = 0;
    for (const e of disponibles) if (e.ultimoPeriodo > max) max = e.ultimoPeriodo;
    return max;
  }, [disponibles]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 mb-2">Elegir entidades</h3>
          <input
            type="search"
            placeholder="Buscar entidad..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded border border-slate-300"
            autoFocus
          />
          <p className="text-[11px] text-slate-500 mt-2">
            {seleccionadas.length}/8 seleccionadas · click para toggle
          </p>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {filtradas.map((e) => {
            const sel = seleccionadas.includes(e.nombCorreg);
            // Gap en meses entre ultimo periodo disponible del sistema y el
            // ultimo periodo de esta entidad. Si >3 meses, la entidad ya
            // no reporta y probablemente sufrio un rename historico.
            const gapMeses = maxPeriodoDisponible && e.ultimoPeriodo
              ? gapEnMeses(e.ultimoPeriodo, maxPeriodoDisponible)
              : 0;
            const obsoleto = gapMeses > 3;
            return (
              <button
                key={e.nombCorreg}
                type="button"
                onClick={() => onToggle(e.nombCorreg)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 ${
                  sel ? "bg-brand-50 text-brand-900" : "text-slate-700"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center ${
                    sel ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300"
                  }`}
                >
                  {sel && <span className="text-[10px]">✓</span>}
                </div>
                <span className="flex-1 text-left flex items-center gap-2">
                  {e.nombCorreg}
                  {obsoleto && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800"
                      title={`Sin data desde ${fmtPeriodoLabel(e.ultimoPeriodo)}. Puede haber cambiado de nombre — revisa entidades similares o activa 'consolidar' para ver la historia unificada.`}
                    >
                      ⚠ sin data reciente
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {e.tipoEntidad} · {fmtPeriodoLabel(e.ultimoPeriodo)}
                </span>
              </button>
            );
          })}
          {filtradas.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">
              Sin resultados para "{q}"
            </div>
          )}
        </div>
        <div className="p-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-8 text-xs font-semibold rounded bg-brand-600 text-white hover:bg-brand-700"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SeccionDupont — layout replica del PDF: narrativa izq + charts der
// ============================================================================

type IndicadorDef = {
  label: string;
  getter: (r: DupontRow) => number | null;
  formato: "pct" | "num";
};

function SeccionDupont({
  numero,
  seccionKey,
  titulo,
  subtitulo,
  indicadorPrincipal,
  subIndicadores,
  data,
  rowsIndex,
  narrativaIA,
}: {
  numero: number;
  seccionKey: "roe" | "roa" | "mon" | "mfb";
  titulo: string;
  subtitulo: string;
  indicadorPrincipal: IndicadorDef;
  subIndicadores: IndicadorDef[];
  data: DupontData;
  rowsIndex: Map<string, DupontRow>;
  narrativaIA: NarrativaState;
}) {
  // Fallback deterministico — se usa si:
  //   - la IA aun no cargo (status=loading)
  //   - la IA fallo o no hay proveedor (status=error/no-provider)
  //   - la IA devolvio un array vacio para esta seccion
  const narrativaFallback = useMemo(
    () =>
      generarNarrativa(
        titulo,
        indicadorPrincipal,
        subIndicadores,
        data,
        rowsIndex,
      ),
    [titulo, indicadorPrincipal, subIndicadores, data, rowsIndex],
  );

  const bulletsIA = narrativaIA.data?.[seccionKey] ?? [];
  const usarIA = narrativaIA.status === "ok" && bulletsIA.length > 0;
  const narrativa = usarIA ? bulletsIA : narrativaFallback;

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      {/* Header de la seccion */}
      <div className="bg-gradient-to-r from-brand-900 to-brand-700 text-white px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">
          {numero}
        </div>
        <div>
          <h2 className="font-bold text-base leading-tight">{titulo}</h2>
          <p className="text-xs opacity-80 leading-tight">{subtitulo}</p>
        </div>
      </div>

      {/* Layout NUEVO — recomendacion UX (Bloomberg/FT/Vercel Analytics):
          la narrativa va ARRIBA como banner colapsable (details/summary),
          no como sidebar. Sin sidebar, el chart usa 100% del ancho de la
          seccion → barras mas gruesas, labels sin colision, con espacio
          para 4-6 entidades sin comprimir.

          El estado open/collapsed persiste en localStorage — cada user
          decide si quiere ver la narrativa siempre o solo cuando la
          pide. */}
      <NarrativaBanner
        narrativa={narrativa}
        status={narrativaIA.status}
        usarIA={usarIA}
      />

      {/* Charts FULL WIDTH — principal arriba, subs abajo en grid mas denso */}
      <div className="p-5 space-y-4">
        <IndicadorChart
          def={indicadorPrincipal}
          data={data}
          rowsIndex={rowsIndex}
          highlight
        />
        {subIndicadores.length > 0 && (
          <div
            className={`grid gap-3 ${
              subIndicadores.length <= 2
                ? "grid-cols-1 md:grid-cols-2"
                : subIndicadores.length <= 3
                  ? "grid-cols-1 md:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {subIndicadores.map((s, i) => (
              <IndicadorChart key={i} def={s} data={data} rowsIndex={rowsIndex} />
            ))}
          </div>
        )}
      </div>

      {/* Footer sutil — expandimos siglas para que un lector no financiero
          entienda sin necesidad de tooltip. Reportado 2026-08-10. */}
      <div className="px-5 py-2 border-t border-slate-100 text-[10px] text-slate-500">
        Base: Activo Promedio de los últimos 12 meses · Fuente: SBS Perú ·
        Valores anualizados TTM (<em>Trailing Twelve Months</em> — últimos 12 meses móviles)
      </div>
    </section>
  );
}

// ============================================================================
// NarrativaBanner — narrativa AI o determinista como banner horizontal
// colapsable arriba del chart (recomendacion UX del agente experto).
// Reemplaza el sidebar vertical de 320px que le quitaba ancho al chart.
//
// Ganancia medible: chart pasa de ~1050px a ~1500px utiles en pantalla
// 1600px. Barras van de 40px → 55px con 4 entidades (35 → 50 con 6).
//
// Estado open/collapsed persiste en localStorage para respetar la
// preferencia del user cross-session.
// ============================================================================

const LS_KEY_NARRATIVA_OPEN = "aibenchef.dupont.narrativa.open.v1";

function NarrativaBanner({
  narrativa,
  status,
  usarIA,
}: {
  narrativa: string[];
  status: "loading" | "ok" | "fallback";
  usarIA: boolean;
}) {
  // Estado open persistente. Default true (mostrar la primera vez).
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = localStorage.getItem(LS_KEY_NARRATIVA_OPEN);
    return raw === null ? true : raw === "true";
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY_NARRATIVA_OPEN, String(next));
    }
  };

  return (
    <div className="border-b border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-5 py-2.5 hover:bg-slate-100/50 transition-colors text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-600">
          Lectura
        </span>
        {status === "loading" && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Generando…
          </span>
        )}
        {usarIA && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700">
            <Wand2 className="w-2.5 h-2.5" />
            IA
          </span>
        )}
        {!open && (
          <span className="text-[10px] text-slate-400 ml-auto italic">
            {narrativa.length} bullets — click para expandir
          </span>
        )}
      </button>
      {open && (
        <div className="px-5 pb-4">
          {status === "loading" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {[80, 90, 70, 85].map((w, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 rounded bg-slate-200 animate-pulse" style={{ width: `${w}%` }} />
                  <div className="h-3 rounded bg-slate-200 animate-pulse" style={{ width: `${w - 15}%` }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2">
              {narrativa.map((n, i) => (
                <div key={i} className="text-xs text-slate-700 leading-relaxed">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        usarIA
                          ? "bg-violet-100 text-violet-700"
                          : "bg-brand-100 text-brand-700"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span>{n}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// IndicadorChart — bar chart agrupado por entidad × periodo
// ============================================================================

function IndicadorChart({
  def,
  data,
  rowsIndex,
  highlight = false,
}: {
  def: IndicadorDef;
  data: DupontData;
  rowsIndex: Map<string, DupontRow>;
  highlight?: boolean;
}) {
  // Transformar a formato recharts: 1 fila por periodo, 1 key por entidad
  const chartData = useMemo(
    () =>
      data.periodos.map((p) => {
        const row: Record<string, string | number | null> = { periodo: p.label };
        for (const ent of data.entidades) {
          const r = rowsIndex.get(`${ent.nombCorreg}|${p.codigo}`);
          row[ent.nombCorreg] = r ? def.getter(r) : null;
        }
        return row;
      }),
    [data.periodos, data.entidades, rowsIndex, def],
  );

  const height = highlight ? 260 : 180;
  const fmtValue = (v: number | null | undefined) =>
    def.formato === "pct" ? fmtPct(v, 2) : fmtNum(v, 2);

  return (
    <div
      className={`rounded-lg border ${
        highlight ? "border-brand-200 bg-brand-50/30" : "border-slate-200 bg-white"
      } p-3`}
    >
      <div className="flex items-center justify-between mb-2">
        <h4
          className={`text-xs font-bold uppercase tracking-wider ${
            highlight ? "text-brand-900" : "text-slate-700"
          }`}
        >
          {def.label}
        </h4>
      </div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 26, right: 12, left: 0, bottom: 4 }}
            barCategoryGap="14%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="periodo"
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={{ stroke: "#cbd5e1" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                def.formato === "pct" ? `${Number(v).toFixed(0)}%` : Number(v).toFixed(1)
              }
              width={40}
            />
            <Tooltip
              cursor={{ fill: "rgba(15, 23, 42, 0.08)" }}
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid #e2e8f0",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              formatter={(value: unknown) => fmtValue(Number(value))}
            />
            {data.entidades.map((ent) => (
              <Bar
                key={ent.nombCorreg}
                dataKey={ent.nombCorreg}
                fill={ent.color}
                radius={[3, 3, 0, 0]}
                maxBarSize={highlight ? 46 : 32}
              >
                {/* Labels EN TODOS los charts — best practice actualizada
                    (feedback usuario 2026-08-10): el analista quiere ver
                    los valores exactos sin depender del hover del tooltip.
                    Chart principal (highlight): fontSize 10, bold.
                    Subcharts: fontSize 9, semibold — mismo formato compacto
                    (1 decimal, sin %) para ganar espacio horizontal. */}
                <LabelList
                  dataKey={ent.nombCorreg}
                  position="top"
                  formatter={(v: unknown) => {
                    const n = Number(v);
                    if (Number.isNaN(n)) return "";
                    // Numeros grandes (>= 10): 1 decimal para ahorrar espacio.
                    // Numeros chicos (< 10): 2 decimales para no perder precision.
                    return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
                  }}
                  style={{
                    fontSize: highlight ? 10 : 9,
                    fill: "#334155",
                    fontWeight: highlight ? 600 : 500,
                  }}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Legenda compacta abajo */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {data.entidades.map((ent) => (
          <span
            key={ent.nombCorreg}
            className="inline-flex items-center gap-1 text-[10px] text-slate-600"
          >
            <span
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: ent.color }}
              aria-hidden
            />
            {ent.nombCorreg}
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Hook useNarrativaIA — 1 fetch al endpoint /api/v1/dupont/insights
//
// Estados:
//   - loading: mientras Claude genera (2-8s primera vez, <200ms si cache)
//   - ok: bullets IA disponibles para las 4 secciones
//   - fallback: sin provider o error del LLM — cliente usa narrativa
//     deterministica automaticamente
//
// Debounce natural: el fetch dispara solo cuando cambia el hash de la
// data (entidades × periodos × valores redondeados a 2 decimales). Cambios
// de color NO invalidan (el color no afecta el prompt).
// ============================================================================

type NarrativaBullets = {
  roe: string[];
  roa: string[];
  mon: string[];
  mfb: string[];
};

type NarrativaState = {
  status: "loading" | "ok" | "fallback";
  data: NarrativaBullets | null;
  model: string | null;
};

function useNarrativaIA(
  data: DupontData,
  initialInsights: DupontInsights | null,
  initialModel: string | null,
): NarrativaState {
  // Si el server ya nos paso initialInsights (cache DB hit en SSR), el
  // estado inicial es "ok" → cero flash de "Generando..." al montar.
  // Si viene null (cache miss), estado inicial es "loading" y el useEffect
  // dispara el fetch client-side.
  const [state, setState] = useState<NarrativaState>(() =>
    initialInsights
      ? { status: "ok", data: initialInsights, model: initialModel }
      : { status: "loading", data: null, model: null },
  );

  // Hash de la data para detectar cambios reales (nueva combinacion de
  // entidades/periodos). Si el hash cambia respecto al initial, sabemos
  // que el user modifico algo y hay que re-fetch.
  const dataKey = useMemo(() => {
    const ents = data.entidades.map((e) => e.nombCorreg).join("|");
    const pers = data.periodos.map((p) => p.codigo).join("|");
    const vals = data.filas
      .map((r) => `${r.entidad}:${r.periodo}:${r.roePct?.toFixed(2) ?? "-"}`)
      .join(",");
    return `${ents}#${pers}#${vals}`;
  }, [data]);

  // Guardamos el dataKey del initial para poder skipear el primer fetch
  // si initialInsights vino poblado — no queremos regenerar lo que ya
  // sabemos que esta en cache.
  const initialKeyRef = useRef<string | null>(initialInsights ? dataKey : null);

  useEffect(() => {
    // Skip: si el server nos dio initialInsights Y el data actual matchea
    // el data del SSR, no re-fetch. La primera navegacion post-mount es
    // instant con SSR data.
    if (initialKeyRef.current === dataKey) {
      // Ya lo tenemos del server, no hacer nada
      return;
    }
    // A partir de aca, el user cambio la data (nuevo peer group / periodos)
    // → fetch fresh. Limpiamos el initialKey para que futuros re-mounts
    // con el mismo dataKey (mismo cambio) no salteen.
    initialKeyRef.current = null;

    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));

    (async () => {
      try {
        const r = await fetch("/api/v1/dupont/insights", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        const nar = json?.data?.narrativa as NarrativaBullets | null | undefined;
        if (cancelled) return;
        if (!nar) {
          setState({ status: "fallback", data: null, model: json?.data?.model ?? null });
        } else {
          setState({ status: "ok", data: nar, model: json?.data?.model ?? null });
        }
      } catch {
        if (cancelled) return;
        setState({ status: "fallback", data: null, model: null });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  return state;
}

// ============================================================================
// Narrativa auto-generada (FALLBACK deterministico si la IA falla)
// ============================================================================

function generarNarrativa(
  _titulo: string,
  principal: IndicadorDef,
  subs: IndicadorDef[],
  data: DupontData,
  rowsIndex: Map<string, DupontRow>,
): string[] {
  const ultimoPeriodo = data.periodos[data.periodos.length - 1];
  if (!ultimoPeriodo) return ["Sin datos para el período seleccionado."];

  const notas: string[] = [];

  // 1. Líder del indicador principal en el último período
  const valoresUltimo = data.entidades
    .map((ent) => {
      const r = rowsIndex.get(`${ent.nombCorreg}|${ultimoPeriodo.codigo}`);
      const v = r ? principal.getter(r) : null;
      return { entidad: ent.nombCorreg, valor: v };
    })
    .filter((x) => x.valor != null) as Array<{ entidad: string; valor: number }>;

  if (valoresUltimo.length > 0) {
    const sortedDesc = [...valoresUltimo].sort((a, b) => b.valor - a.valor);
    const top = sortedDesc[0]!;
    const bottom = sortedDesc[sortedDesc.length - 1]!;
    const fmt = principal.formato === "pct" ? fmtPct : fmtNum;
    notas.push(
      `${top.entidad} lidera ${principal.label} en ${ultimoPeriodo.label} con ${fmt(top.valor, 2)}.`,
    );
    if (top.entidad !== bottom.entidad && Math.abs(top.valor - bottom.valor) > 0.01) {
      notas.push(
        `Spread vs ${bottom.entidad}: ${fmt(top.valor - bottom.valor, 2)} — brecha ${
          Math.abs(top.valor - bottom.valor) > 5 ? "amplia" : "moderada"
        }.`,
      );
    }
  }

  // 2. Tendencia — comparar primer vs ultimo periodo si hay >1
  if (data.periodos.length > 1) {
    const primerPeriodo = data.periodos[0]!;
    for (const ent of data.entidades.slice(0, 2)) {
      const rIni = rowsIndex.get(`${ent.nombCorreg}|${primerPeriodo.codigo}`);
      const rFin = rowsIndex.get(`${ent.nombCorreg}|${ultimoPeriodo.codigo}`);
      const vIni = rIni ? principal.getter(rIni) : null;
      const vFin = rFin ? principal.getter(rFin) : null;
      if (vIni != null && vFin != null) {
        const delta = vFin - vIni;
        const direccion = delta > 0.1 ? "sube" : delta < -0.1 ? "baja" : "se mantiene";
        const fmt = principal.formato === "pct" ? fmtPct : fmtNum;
        notas.push(
          `${ent.nombCorreg} ${direccion} desde ${fmt(vIni, 2)} (${primerPeriodo.label}) a ${fmt(vFin, 2)} (${ultimoPeriodo.label}).`,
        );
        break; // 1 tendencia clave, no saturar
      }
    }
  }

  // 3. Sub-indicador con mayor spread
  if (subs.length > 0) {
    let mayorSpread = { label: "", spread: 0 };
    for (const sub of subs) {
      const vals = data.entidades
        .map((ent) => {
          const r = rowsIndex.get(`${ent.nombCorreg}|${ultimoPeriodo.codigo}`);
          return r ? sub.getter(r) : null;
        })
        .filter((v): v is number => v != null);
      if (vals.length < 2) continue;
      const spread = Math.max(...vals) - Math.min(...vals);
      if (spread > mayorSpread.spread) mayorSpread = { label: sub.label, spread };
    }
    if (mayorSpread.spread > 0.5) {
      notas.push(
        `Mayor dispersión entre entidades en ${mayorSpread.label} (spread ${mayorSpread.spread.toFixed(2)}).`,
      );
    }
  }

  if (notas.length === 0) {
    notas.push(
      "Datos insuficientes o sin variación significativa en el período seleccionado.",
    );
  }
  return notas;
}
