"use client";

/**
 * PuntoEquilibrioClient — vista completa del PE con:
 *   - Selectores: entidad, rango desde/hasta, granularidad, peer group
 *   - Tab 1: Histórico (tabla con componentes por periodo)
 *   - Tab 2: Comparativo (line chart evolucion temporal + tabla)
 *
 * URL sincronizada — selectores modifican la URL para poder compartir.
 */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3, Calendar, ChevronDown, ChevronRight, GripVertical, Info, Layers, RotateCcw, TrendingUp, Users, X,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

import { cn } from "@/lib/utils/cn";
import { RenombresToggle } from "@/components/ui";
import type { Cliente } from "@/lib/domains/informe/types";
import type {
  Granularidad,
  PuntoEquilibrioRow,
  PuntoEquilibrioSerie,
} from "@/lib/domains/punto-equilibrio";
import { EntityCombobox } from "./entity-combobox";

type EntidadDisponible = {
  nombCorreg: string;
  primerPeriodo: number;
  ultimoPeriodo: number;
};

type Config = {
  desdeAnio: number;
  hastaPeriodo: number;
  granularidad: Granularidad;
  peerGroup: string[];
  consolidar: boolean;
};

type Props = {
  cliente: Cliente;
  entidadActual: string;
  periodo: { codigo: number; label: string };
  historico: PuntoEquilibrioRow[];
  series: PuntoEquilibrioSerie[];
  entidadesDisponibles: EntidadDisponible[];
  config: Config;
};

type Tab = "historico" | "comparativo";

const GRANULARIDADES: Array<{ value: Granularidad; label: string; hint: string }> = [
  { value: "cierre", label: "Cierre único", hint: "Solo el 'Hasta período'" },
  { value: "anual", label: "Anual", hint: "Solo Diciembres" },
  { value: "semestral", label: "Semestral", hint: "Junio + Diciembre" },
  { value: "trimestral", label: "Trimestral", hint: "Mar, Jun, Sep, Dic" },
  { value: "mensual", label: "Mensual", hint: "Todos los meses" },
];

const ANIO_MIN = 2009; // Data SBS disponible desde 2009

/**
 * DraftState — todos los filtros que el usuario puede editar. Se guarda
 * localmente y solo se aplica (dispara SSR + URL update) cuando el usuario
 * hace click en 'Aplicar filtros'. Patron enterprise clasico —
 * Salesforce/Tableau/PowerBI — para no gastar queries innecesarias
 * cuando el usuario esta configurando varios filtros a la vez.
 */
type DraftState = {
  entidad: string;
  desdeAnio: number;
  granularidad: Granularidad;
  hastaPeriodo: number;
  peerGroup: string[];
  consolidar: boolean;
};

export function PuntoEquilibrioClient({
  cliente,
  entidadActual,
  periodo,
  historico,
  series,
  entidadesDisponibles,
  config,
}: Props) {
  const [tab, setTab] = useState<Tab>("historico");
  const [peerModalCierreOpen, setPeerModalCierreOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Estado APLICADO (viene del SSR — refleja los URL params actuales)
  const applied: DraftState = useMemo(
    () => ({
      entidad: entidadActual,
      desdeAnio: config.desdeAnio,
      granularidad: config.granularidad,
      hastaPeriodo: config.hastaPeriodo,
      peerGroup: config.peerGroup,
      consolidar: config.consolidar,
    }),
    [entidadActual, config.desdeAnio, config.granularidad, config.hastaPeriodo, config.peerGroup, config.consolidar],
  );

  // Estado DRAFT — el usuario edita libremente sin disparar re-fetch.
  // Se re-sincroniza con applied cuando el SSR responde (o cuando el user
  // navega con back/forward y cambian los searchParams).
  const [draft, setDraft] = useState<DraftState>(applied);

  useEffect(() => {
    setDraft(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied.entidad, applied.desdeAnio, applied.granularidad, applied.hastaPeriodo, applied.peerGroup.join(","), applied.consolidar]);

  // Contador de cambios pendientes vs applied.
  const changeCount = useMemo(() => {
    let n = 0;
    if (draft.entidad !== applied.entidad) n++;
    if (draft.desdeAnio !== applied.desdeAnio) n++;
    if (draft.granularidad !== applied.granularidad) n++;
    if (draft.hastaPeriodo !== applied.hastaPeriodo) n++;
    if (draft.peerGroup.join(",") !== applied.peerGroup.join(",")) n++;
    if (draft.consolidar !== applied.consolidar) n++;
    return n;
  }, [draft, applied]);

  // Preservacion de scroll cuando aplicamos filtros.
  const scrollToRestore = useRef<number | null>(null);

  const applyFilters = () => {
    if (changeCount === 0) return;
    scrollToRestore.current = window.scrollY;
    const params = new URLSearchParams(searchParams.toString());
    params.set("entidad", draft.entidad);
    params.set("desde", String(draft.desdeAnio));
    params.set("granularidad", draft.granularidad);
    params.set("periodo", String(draft.hastaPeriodo));
    if (draft.peerGroup.length > 0) {
      params.set("peers", draft.peerGroup.join(","));
    } else {
      params.delete("peers");
    }
    // consolidar solo va en URL cuando es false (default true — URL limpia)
    if (draft.consolidar) params.delete("consolidar");
    else params.set("consolidar", "false");
    router.replace(
      `/dashboard/punto-equilibrio?${params.toString()}` as never,
      { scroll: false },
    );
  };

  const resetFilters = () => {
    setDraft(applied);
  };

  // Enter para aplicar (excepto si el foco esta en un input de texto
  // que ya lo usa para submit — evitamos conflicto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && changeCount > 0) {
        e.preventDefault();
        applyFilters();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeCount, draft]);

  // Se dispara cada vez que la data cambia (post-SSR fetch). Si hay un
  // scroll pendiente de restaurar, lo aplicamos ANTES del paint via
  // useLayoutEffect para evitar flash de la posicion.
  useLayoutEffect(() => {
    if (scrollToRestore.current !== null) {
      const y = scrollToRestore.current;
      scrollToRestore.current = null;
      // rAF para asegurar que el DOM ya se pinto tras el re-render
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    // La dep es historico+series+config — cambia cuando SSR re-fetcha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historico, series, config.desdeAnio, config.granularidad, config.hastaPeriodo, config.peerGroup.join(",")]);

  // Fallback adicional: si searchParams cambia (via back/forward del
  // browser), tambien restauramos si tenemos scroll pendiente.
  useEffect(() => {
    if (scrollToRestore.current !== null) {
      const y = scrollToRestore.current;
      scrollToRestore.current = null;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [searchParams]);

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto px-2">
      {/* Header con branding del cliente + tooltip 'que es el PE' inline.
          overflow-visible (no hidden) para que el popover del InfoTooltip
          pueda escapar del hero — el gradient vive en el propio header
          asi que rounded-xl sigue funcionando sin clip. */}
      <header
        className="rounded-xl text-white p-6 relative"
        style={{
          background: `linear-gradient(135deg, ${cliente.brand.primary} 0%, ${cliente.brand.acento} 100%)`,
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap relative z-10">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-75 mb-1">
              Análisis financiero
            </p>
            <h1 className="text-2xl md:text-3xl font-bold mb-1 flex items-center gap-2">
              Punto de Equilibrio
              <InfoTooltip
                content={
                  <>
                    <strong className="block mb-1 text-slate-900">¿Qué es?</strong>
                    Es el rendimiento mínimo sobre cartera que necesitas para cubrir todos los
                    costos (fondeo + provisiones + gastos operacionales), en % de la cartera
                    promedio 12 meses.
                    <br />
                    <br />
                    Si tu rendimiento real <strong>supera el PE</strong>, generas margen.
                    Si no, hay pérdida.
                  </>
                }
              />
            </h1>
            <p className="text-sm opacity-90">
              {entidadActual} · Cierre {periodo.label}
            </p>
          </div>
        </div>
      </header>

      {/* SELECTORES globales (sin peer group — ese va en el tab Comparativo) */}
      <SelectoresBar
        entidadesDisponibles={entidadesDisponibles}
        draft={draft}
        setDraft={setDraft}
        changeCount={changeCount}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      {/* Tabs — el nombre del primer tab cambia segun granularidad:
          - modo cierre: 'Cuadro por entidad' (tabla comparativa multi-entidad)
          - modo historico: 'Historico de mi entidad' (tabla de 1 entidad × N periodos)
          Esto porque en modo cierre la tabla historica quedaria con 1 sola
          columna → poco util. En su lugar mostramos el cuadro comparativo. */}
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-1">
          <TabButton
            active={tab === "historico"}
            onClick={() => setTab("historico")}
            icon={config.granularidad === "cierre" ? Users : TrendingUp}
            label={
              config.granularidad === "cierre"
                ? `Cuadro por entidad (${config.peerGroup.length})`
                : "Histórico de mi entidad"
            }
          />
          <TabButton
            active={tab === "comparativo"}
            onClick={() => setTab("comparativo")}
            icon={Users}
            label={`Comparativo (${config.peerGroup.length})`}
          />
        </div>
      </div>

      {tab === "historico" && config.granularidad === "cierre" && (
        // Modo cierre: reemplazamos la tabla historica por el cuadro
        // comparativo tabular (filas = componentes, cols = entidades).
        // Selector de entidades inline (PeerGroupControl) para que el user
        // pueda agregar/quitar sin ir al otro tab.
        <div className="space-y-4">
          <PeerGroupControl
            peerGroup={draft.peerGroup}
            onChangePeers={(nuevos) => setDraft((d) => ({ ...d, peerGroup: nuevos }))}
            onOpenModal={() => setPeerModalCierreOpen(true)}
          />
          <TablaComparativaCierre series={series} />
          {peerModalCierreOpen && (
            <PeerGroupModal
              disponibles={entidadesDisponibles}
              seleccionados={draft.peerGroup}
              onSave={(nuevos) => {
                setDraft((d) => ({ ...d, peerGroup: nuevos }));
                setPeerModalCierreOpen(false);
              }}
              onClose={() => setPeerModalCierreOpen(false)}
            />
          )}
        </div>
      )}
      {tab === "historico" && config.granularidad !== "cierre" && (
        <HistoricoTable data={historico} entidad={entidadActual} />
      )}
      {tab === "comparativo" && (
        <ComparativoView
          series={series}
          entidadActual={entidadActual}
          draftPeerGroup={draft.peerGroup}
          entidadesDisponibles={entidadesDisponibles}
          onChangePeers={(nuevos) => setDraft((d) => ({ ...d, peerGroup: nuevos }))}
          onAddEntidadAlComparativo={() => {
            if (!draft.peerGroup.includes(draft.entidad)) {
              setDraft((d) => ({ ...d, peerGroup: [...d.peerGroup, d.entidad] }));
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Barra de selectores con draft state. Los cambios editan `draft`; el
 * usuario clickea 'Aplicar filtros' para disparar el fetch. Cuando hay
 * cambios pendientes, la barra tiene un highlight ambar visible y
 * aparecen los botones Aplicar / Descartar.
 */
function SelectoresBar({
  entidadesDisponibles,
  draft,
  setDraft,
  changeCount,
  onApply,
  onReset,
}: {
  entidadesDisponibles: EntidadDisponible[];
  draft: DraftState;
  setDraft: (fn: (prev: DraftState) => DraftState) => void;
  changeCount: number;
  onApply: () => void;
  onReset: () => void;
}) {
  // Años disponibles: desde 2009 hasta año actual del draft
  const anioActual = Math.floor(draft.hastaPeriodo / 100);
  const aniosDisponibles = useMemo(() => {
    const r: number[] = [];
    for (let a = ANIO_MIN; a <= anioActual; a++) r.push(a);
    return r;
  }, [anioActual]);

  const dirty = changeCount > 0;

  return (
    <section
      className={cn(
        "bg-white border rounded-lg p-4 shadow-sm transition-colors",
        dirty ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200",
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Entidad — combobox con search */}
        <EntityCombobox
          label="Entidad"
          value={draft.entidad}
          options={entidadesDisponibles}
          onChange={(v) => setDraft((d) => ({ ...d, entidad: v }))}
        />

        {/* Desde año — deshabilitado en modo 'Cierre único' porque no aplica
            (ese modo muestra solo el hasta-periodo). */}
        <div>
          <label
            className={cn(
              "text-[10px] uppercase font-semibold tracking-wider flex items-center gap-1 mb-1",
              draft.granularidad === "cierre" ? "text-slate-300" : "text-slate-500",
            )}
          >
            <Calendar className="w-3 h-3" />
            Desde año
            {draft.granularidad === "cierre" && (
              <span className="text-[9px] normal-case italic text-slate-400">
                (no aplica en cierre único)
              </span>
            )}
          </label>
          <select
            value={draft.desdeAnio}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              setDraft((d) => ({ ...d, desdeAnio: v }));
            }}
            disabled={draft.granularidad === "cierre"}
            className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {aniosDisponibles.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {/* Granularidad */}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1 mb-1">
            <Layers className="w-3 h-3" />
            Granularidad
          </label>
          <select
            value={draft.granularidad}
            onChange={(e) => {
              const v = e.target.value as Granularidad;
              setDraft((d) => ({ ...d, granularidad: v }));
            }}
            className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
          >
            {GRANULARIDADES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label} — {g.hint}
              </option>
            ))}
          </select>
        </div>

        {/* Hasta periodo */}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1 mb-1">
            <Calendar className="w-3 h-3" />
            Hasta periodo (YYYYMM)
          </label>
          <input
            type="number"
            value={draft.hastaPeriodo}
            min={200901}
            max={210012}
            step={1}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (n >= 200901 && n <= 210012) {
                setDraft((d) => ({ ...d, hastaPeriodo: n }));
              }
            }}
            className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white font-mono"
          />
        </div>
      </div>

      {/* Toggle 'Renombres unidos/separados' — mismo componente que
          Benchmark y DuPont para consistencia UX cross-vista.
          En PE default es TRUE (analisis historico necesita continuidad). */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <RenombresToggle
          value={draft.consolidar}
          onChange={(next) => setDraft((d) => ({ ...d, consolidar: next }))}
        />
      </div>

      {/* Barra de accion: Aplicar / Descartar. Aparece solo si hay cambios. */}
      <div
        className={cn(
          "mt-4 pt-3 border-t transition-colors flex items-center justify-between gap-3 flex-wrap",
          dirty ? "border-amber-200" : "border-slate-100",
        )}
      >
        <div className="flex items-center gap-2 text-xs">
          {dirty ? (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {changeCount} {changeCount === 1 ? "cambio pendiente" : "cambios pendientes"}
              </span>
              <span className="text-slate-400 hidden sm:inline">
                Ctrl+Enter para aplicar
              </span>
            </>
          ) : (
            <span className="text-slate-400 italic">
              Los filtros están sincronizados con la vista
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={!dirty}
            className={cn(
              "h-9 px-3 text-sm font-medium rounded-md transition-colors",
              dirty
                ? "text-slate-700 hover:bg-slate-100 border border-slate-300"
                : "text-slate-400 border border-transparent cursor-not-allowed",
            )}
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!dirty}
            className={cn(
              "h-9 px-4 text-sm font-medium rounded-md shadow-sm inline-flex items-center gap-1.5 transition-colors",
              dirty
                ? "bg-brand-600 hover:bg-brand-700 text-white"
                : "bg-slate-200 text-slate-500 cursor-not-allowed",
            )}
          >
            Aplicar filtros
            {dirty && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 text-[10px] font-bold bg-white/25 rounded">
                {changeCount}
              </span>
            )}
          </button>
        </div>
      </div>

    </section>
  );
}

function PeerGroupModal({
  disponibles,
  seleccionados,
  onSave,
  onClose,
}: {
  disponibles: EntidadDisponible[];
  seleccionados: string[];
  onSave: (nuevos: string[]) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState(new Set(seleccionados));
  const [search, setSearch] = useState("");
  const filtered = disponibles.filter((e) =>
    !search || e.nombCorreg.toLowerCase().includes(search.toLowerCase()),
  );
  const toggle = (n: string) => {
    const next = new Set(sel);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setSel(next);
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl rounded-xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Editar comparación</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Selecciona 1 o más entidades para comparar con tu entidad principal
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-5 py-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar entidad…"
            className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
            autoFocus
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            Seleccionadas: <strong>{sel.size}</strong> de {disponibles.length}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filtered.map((e) => (
            <label
              key={e.nombCorreg}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-slate-50",
                sel.has(e.nombCorreg) && "bg-brand-50",
              )}
            >
              <input
                type="checkbox"
                checked={sel.has(e.nombCorreg)}
                onChange={() => toggle(e.nombCorreg)}
                className="w-4 h-4"
              />
              <span className="text-sm text-slate-800 flex-1">{e.nombCorreg}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {e.primerPeriodo} – {e.ultimoPeriodo}
              </span>
            </label>
          ))}
        </div>
        <footer className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            className="px-3 h-9 text-sm text-slate-700 hover:bg-slate-100 rounded"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(Array.from(sel))}
            className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded"
          >
            Aplicar {sel.size > 0 && `(${sel.size})`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean; onClick: () => void; icon: typeof BarChart3; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300",
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

/**
 * Definicion de las filas — cada una es un componente del cuadro.
 * variant define el estilo visual:
 *   - 'sum': verde, prefix (+)
 *   - 'sub': rojo, prefix (-)
 *   - 'bold': fila calculada tipo Margen (fondo gris, bold)
 *   - 'highlight': fila resumen PE (fondo brand, uppercase, mas grande)
 */
type RowDef = {
  key: string;
  label: string;
  field: keyof PuntoEquilibrioRow;
  variant: "sum" | "sub" | "bold" | "highlight";
  /** Tooltip explicativo para la fila (mostrado con InfoTooltip). */
  info?: string;
  /** Sub-filas que se muestran al expandir esta fila (patron Excel agrupar). */
  subrows?: Array<{ key: string; label: string; field: keyof PuntoEquilibrioRow }>;
};

const DEFAULT_ROW_ORDER: RowDef[] = [
  {
    key: "rendimiento",
    label: "Rendimiento de cartera",
    field: "pctRendimiento",
    variant: "sum",
    info: "Ingresos por intereses de créditos directos (SBS cta 1.4) ÷ Cartera Promedio 12M × 100. Es el retorno bruto que la cartera genera antes de restar costos.",
  },
  {
    key: "otros",
    label: "Otros Ingresos (Egresos)",
    field: "pctOtros",
    variant: "sum",
    info: "Ingresos netos por servicios financieros + ganancia por venta de cartera + otros ingresos/gastos. Fórmula SBS: (cta 6 − cta 7 + cta 8 + cta 13) ÷ Cartera Promedio 12M.",
    subrows: [
      { key: "isf", label: "Ingresos por Servicios Financieros (cta 6)", field: "pctISF" },
      { key: "gsf", label: "Gastos por Servicios Financieros (cta 7)", field: "pctGSF" },
      { key: "venta", label: "Ganancia por Venta de Cartera (cta 8)", field: "pctVentaCartera" },
      { key: "otrosIG", label: "Otros Ingresos y Gastos (cta 13)", field: "pctOtrosIngGas" },
    ],
  },
  {
    key: "costoFondeo",
    label: "Gasto Financiero",
    field: "pctCostoFondeo",
    variant: "sub",
    info: "Intereses pagados por fuentes de fondeo (SBS cta 2). Incluye depósitos del público, adeudos, obligaciones en circulación, etc. Signo negativo — es un costo.",
    subrows: [
      { key: "publico", label: "Obligaciones con el Público (cta 2.1)", field: "pctGfPublico" },
      { key: "sf", label: "Depósitos SF + Organismos (cta 2.2)", field: "pctGfSF" },
      { key: "adeudos", label: "Adeudos y Obligaciones (cta 2.4)", field: "pctGfAdeudos" },
      { key: "obligCirc", label: "Obligaciones en Circulación (cta 2.5+2.6)", field: "pctGfObligaciones" },
      { key: "otrosFin", label: "Otros gastos financieros", field: "pctGfOtrosFin" },
    ],
  },
  {
    key: "provisiones",
    label: "Costo de Provisión",
    field: "pctProvisiones",
    variant: "sub",
    info: "Provisiones para incobrabilidad de créditos (cta 4.2) + provisiones para desvalorización de inversiones (cta 4.1). Signo negativo — es un costo.",
    subrows: [
      { key: "provCred", label: "Provisiones para Créditos (cta 4.2)", field: "pctProvCredito" },
      { key: "provInv", label: "Provisiones para Inversiones (cta 4.1)", field: "pctProvInversion" },
    ],
  },
  {
    key: "gastosOp",
    label: "Gastos Operacionales",
    field: "pctGastosOp",
    variant: "sub",
    info: "Personal (cta 10.1) + Servicios Terceros + Impuestos (cta 10.3+10.4) + Depreciación + Amortización (cta 12.7+12.8). Todos los costos operativos ÷ Cartera Promedio 12M.",
    subrows: [
      { key: "personal", label: "Personal (cta 10.1)", field: "pctPersonal" },
      { key: "generales", label: "Servicios Terceros + Impuestos (cta 10.3+10.4)", field: "pctGenerales" },
      { key: "deprec", label: "Depreciación + Amortización (cta 12.7+12.8)", field: "pctDepreciacion" },
    ],
  },
  {
    key: "margenNeto",
    label: "Margen antes de Impuestos",
    field: "pctMargenNeto",
    variant: "bold",
    info: "Suma algebraica de todos los componentes: Rendimiento + Otros − Gasto Financiero − Costo Provisión − Gastos Operacionales. Es lo que la entidad genera antes de pagar impuestos y participación de trabajadores.",
  },
  {
    key: "puntoEq",
    label: "Punto de Equilibrio",
    field: "pctPuntoEq",
    variant: "highlight",
    info: "Rendimiento mínimo requerido sobre cartera para cubrir todos los costos netos de Otros Ingresos. Fórmula: −(Otros + Gasto Financiero + Costo Provisión + Gastos Operacionales). Si Rendimiento > PE, la entidad genera margen positivo.",
  },
];

const LS_EXPANDED_ROWS = "pe-expanded-rows-v1";

/**
 * Punto de Equilibrio — formula del analista financiero senior (Juan Jose):
 *
 *   PE = − ( Otros Ingresos + Gasto Financiero + Costo de Provision + Gastos Operacionales )
 *
 * Es decir: el UMBRAL de rendimiento sobre cartera que la entidad necesita
 * para cubrir todos los costos (financieros + provisiones + operacionales)
 * NETO de Otros Ingresos. Se usa signo NEGADO en vez de valor absoluto:
 *   - Si costos > otros ingresos (comun) → PE > 0 (deficit a cubrir)
 *   - Si otros ingresos > costos (raro) → PE < 0 (superavit natural)
 *
 * El backend calcula _punto_eq = costo_fondeo + provisiones + gastos_op
 * (SIN incluir Otros). Recomputamos en el frontend con la formula correcta
 * usando los componentes que ya vienen en el row. No cambiamos backend para
 * no romper /informe u otras vistas que consumen la MV.
 *
 * Verificacion contra tabla del analista (Al cierre 2021 CA):
 *   Rend=22.9, Otros=0.8, GF=-5.3, Prov=-0.9, GO=-10.8
 *   PE = −(0.8 − 5.3 − 0.9 − 10.8) = −(−16.2) = +16.2% ✓
 *   Margen = 22.9 + 0.8 - 5.3 - 0.9 - 10.8 = 6.7% ✓ (backend ya lo calcula bien)
 */
function computedPuntoEq(row: {
  pctOtros: number | null;
  pctCostoFondeo: number | null;
  pctProvisiones: number | null;
  pctGastosOp: number | null;
}): number | null {
  const parts = [row.pctOtros, row.pctCostoFondeo, row.pctProvisiones, row.pctGastosOp];
  if (parts.some((p) => p == null)) return null;
  const sum = (parts as number[]).reduce((a, b) => a + b, 0);
  return -sum;
}

function displayValueForField(
  field: keyof PuntoEquilibrioRow,
  v: number | null,
  row?: PuntoEquilibrioRow,
): number | null {
  if (field === "pctPuntoEq" && row) return computedPuntoEq(row);
  return v;
}

const LS_ROW_ORDER = "pe-row-order-v1";
const LS_COL_ORDER = "pe-col-order-v1";

/**
 * Cuadro historico con drag & drop libre de filas Y columnas.
 * Persiste orden en localStorage — el usuario mantiene su layout entre
 * sesiones. Boton 'Restablecer orden' vuelve al default cronologico.
 *
 * NOTA: el orden visual NO afecta el calculo del Margen ni del PE.
 * Ambos vienen pre-computados del backend sobre los componentes.
 */
function HistoricoTable({
  data, entidad,
}: { data: PuntoEquilibrioRow[]; entidad: string }) {
  // Orden de filas (por key) y columnas (por periodo). Se hidratan desde
  // localStorage al mount para preservar el layout del usuario.
  const [rowOrder, setRowOrder] = useState<string[]>(() =>
    DEFAULT_ROW_ORDER.map((r) => r.key),
  );
  const [colOrder, setColOrder] = useState<number[] | null>(null);

  // Estado de expand/collapse por fila padre. Persiste en localStorage.
  // Default vacio (todo colapsado) — user opt-in del detalle.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_EXPANDED_ROWS);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setExpandedRows(new Set(arr));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleExpanded = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(LS_EXPANDED_ROWS, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Hidratar desde localStorage
  useEffect(() => {
    try {
      const rowsRaw = localStorage.getItem(LS_ROW_ORDER);
      if (rowsRaw) {
        const arr = JSON.parse(rowsRaw) as string[];
        // Validar: mismo set de keys que el default
        const defaultKeys = new Set(DEFAULT_ROW_ORDER.map((r) => r.key));
        if (arr.every((k) => defaultKeys.has(k)) && arr.length === defaultKeys.size) {
          setRowOrder(arr);
        }
      }
      const colsRaw = localStorage.getItem(LS_COL_ORDER);
      if (colsRaw) {
        setColOrder(JSON.parse(colsRaw) as number[]);
      }
    } catch {
      /* localStorage no disponible o corrupto — usar defaults */
    }
  }, []);

  // Persistir cuando cambia
  useEffect(() => {
    try {
      localStorage.setItem(LS_ROW_ORDER, JSON.stringify(rowOrder));
    } catch { /* ignore */ }
  }, [rowOrder]);

  useEffect(() => {
    if (colOrder === null) return;
    try {
      localStorage.setItem(LS_COL_ORDER, JSON.stringify(colOrder));
    } catch { /* ignore */ }
  }, [colOrder]);

  // Columnas efectivas: si hay orden guardado y matchea con los periodos
  // actuales, usarlo. Si no, usar el orden que vino del backend.
  const effectiveCols = useMemo(() => {
    const currentPeriodos = data.map((d) => d.periodo);
    if (!colOrder) return currentPeriodos;
    const saved = colOrder.filter((p) => currentPeriodos.includes(p));
    // Agregar periodos nuevos que no estaban en el orden guardado
    for (const p of currentPeriodos) {
      if (!saved.includes(p)) saved.push(p);
    }
    return saved;
  }, [colOrder, data]);

  // Filas efectivas ordenadas
  const effectiveRows = useMemo(() => {
    return rowOrder
      .map((k) => DEFAULT_ROW_ORDER.find((r) => r.key === k))
      .filter((r): r is RowDef => Boolean(r));
  }, [rowOrder]);

  const dataByPeriodo = useMemo(() => {
    const m = new Map<number, PuntoEquilibrioRow>();
    for (const d of data) m.set(d.periodo, d);
    return m;
  }, [data]);

  // Drag state
  const [draggedRow, setDraggedRow] = useState<string | null>(null);
  const [draggedCol, setDraggedCol] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ type: "row" | "col"; id: string | number } | null>(null);

  const resetOrder = () => {
    setRowOrder(DEFAULT_ROW_ORDER.map((r) => r.key));
    setColOrder(null);
    try {
      localStorage.removeItem(LS_ROW_ORDER);
      localStorage.removeItem(LS_COL_ORDER);
    } catch { /* ignore */ }
  };

  const isCustomOrder =
    rowOrder.join(",") !== DEFAULT_ROW_ORDER.map((r) => r.key).join(",") ||
    colOrder !== null;

  const moveRow = (from: string, to: string) => {
    if (from === to) return;
    setRowOrder((prev) => {
      const arr = [...prev];
      const fromIdx = arr.indexOf(from);
      const toIdx = arr.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return prev;
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, from);
      return arr;
    });
  };

  const moveCol = (from: number, to: number) => {
    if (from === to) return;
    setColOrder((prev) => {
      const base = prev ?? data.map((d) => d.periodo);
      const arr = [...base];
      const fromIdx = arr.indexOf(from);
      const toIdx = arr.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return prev;
      arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, from);
      return arr;
    });
  };

  if (data.length === 0) return <EmptyState />;

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Cuadro histórico — {entidad}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Valores anualizados (últimos 12 meses móviles). Arrastra el ícono <GripVertical className="w-3 h-3 inline text-slate-400" /> para
            reordenar filas o columnas. El orden se guarda en tu navegador.
          </p>
        </div>
        {isCustomOrder && (
          <button
            type="button"
            onClick={resetOrder}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium bg-white border border-slate-300 hover:bg-slate-50 rounded text-slate-700"
            title="Restablecer al orden por defecto (cronológico + contable)"
          >
            <RotateCcw className="w-3 h-3" />
            Restablecer orden
          </button>
        )}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700 min-w-[240px] sticky left-0 bg-slate-100 z-10">
                Componente
              </th>
              {effectiveCols.map((periodo) => {
                const label = dataByPeriodo.get(periodo)?.periodoLabel ?? String(periodo);
                const isDropTarget = dropTarget?.type === "col" && dropTarget.id === periodo;
                const isDragging = draggedCol === periodo;
                return (
                  <th
                    key={periodo}
                    draggable
                    onDragStart={(e) => {
                      setDraggedCol(periodo);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDraggedCol(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (draggedCol != null && draggedCol !== periodo) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropTarget({ type: "col", id: periodo });
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTarget?.id === periodo) setDropTarget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedCol != null) moveCol(draggedCol, periodo);
                      setDropTarget(null);
                    }}
                    className={cn(
                      "text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700 min-w-[95px] whitespace-nowrap cursor-move select-none",
                      "hover:bg-slate-200 transition-colors group",
                      isDragging && "opacity-40",
                      isDropTarget && "bg-brand-100 ring-2 ring-brand-500 ring-inset",
                    )}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-slate-500" />
                      {label}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {effectiveRows.map((row, idx) => {
              const isDropTarget = dropTarget?.type === "row" && dropTarget.id === row.key;
              const isDragging = draggedRow === row.key;
              const rowStyle = getRowStyle(row.variant);
              const hasSubrows = !!row.subrows && row.subrows.length > 0;
              const isExpanded = hasSubrows && expandedRows.has(row.key);
              return (
                <Fragment key={row.key}>
                <tr
                  draggable
                  onDragStart={(e) => {
                    setDraggedRow(row.key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDraggedRow(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    if (draggedRow && draggedRow !== row.key) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropTarget({ type: "row", id: row.key });
                    }
                  }}
                  onDragLeave={() => {
                    if (dropTarget?.id === row.key) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedRow) moveRow(draggedRow, row.key);
                    setDropTarget(null);
                  }}
                  className={cn(
                    "cursor-move transition-colors",
                    idx > 0 && "border-t border-slate-100",
                    row.variant === "bold" && "border-t border-slate-200 bg-slate-50",
                    row.variant === "highlight" && "border-t-2 border-slate-800 bg-brand-50",
                    isDragging && "opacity-40",
                    isDropTarget && "ring-2 ring-brand-500 ring-inset bg-brand-50",
                  )}
                >
                  <td
                    className={cn(
                      "px-4 sticky left-0 z-10 group",
                      rowStyle.labelClass,
                      row.variant === "bold" && "bg-slate-50",
                      row.variant === "highlight" && "bg-brand-50",
                      !["bold", "highlight"].includes(row.variant) && "bg-white hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                      {hasSubrows ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row.key)}
                          className="w-4 h-4 flex items-center justify-center rounded hover:bg-slate-200 flex-shrink-0"
                          aria-label={isExpanded ? "Colapsar detalle" : "Expandir detalle"}
                          title={isExpanded ? "Colapsar detalle" : "Ver detalle"}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-slate-600" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-slate-600" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 h-4 flex-shrink-0" />
                      )}
                      {rowStyle.prefix && (
                        <span className="text-slate-400 font-mono">{rowStyle.prefix}</span>
                      )}
                      <span>{row.label}</span>
                      {row.info && (
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-brand-600 hover:bg-brand-50 cursor-help flex-shrink-0"
                          title={row.info}
                          aria-label={`Info: ${row.info}`}
                        >
                          <Info className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </td>
                  {effectiveCols.map((periodo) => {
                    const d = dataByPeriodo.get(periodo);
                    const raw = d ? (d[row.field] as number | null) : null;
                    const v = displayValueForField(row.field, raw, d);
                    return (
                      <td
                        key={periodo}
                        className={cn(
                          "text-right px-3 font-mono tabular-nums whitespace-nowrap",
                          rowStyle.valueClass,
                          row.variant === "sum" && v != null && "text-emerald-700",
                          row.variant === "sub" && v != null && "text-rose-700",
                          v == null && "text-slate-400 italic",
                        )}
                      >
                        {fmtPct(v)}
                      </td>
                    );
                  })}
                </tr>
                {isExpanded && row.subrows?.map((sub, subIdx) => (
                  <tr
                    key={`${row.key}__${sub.key}`}
                    className={cn(
                      "bg-slate-50/40 hover:bg-slate-50/80 transition-colors",
                      subIdx === 0 && "border-t border-dashed border-slate-200",
                    )}
                  >
                    <td className="px-4 sticky left-0 z-10 bg-slate-50/60">
                      <div className="flex items-center gap-2 pl-8 py-1 text-[11.5px] text-slate-500">
                        <span className="text-slate-300 text-[10px]">└</span>
                        <span>{sub.label}</span>
                      </div>
                    </td>
                    {effectiveCols.map((periodo) => {
                      const d = dataByPeriodo.get(periodo);
                      const raw = d ? (d[sub.field] as number | null | undefined) : null;
                      const v = raw == null ? null : displayValueForField(sub.field, raw, d);
                      return (
                        <td
                          key={periodo}
                          className={cn(
                            "text-right px-3 py-1 font-mono tabular-nums whitespace-nowrap text-[11.5px]",
                            v != null && v < 0 && "text-rose-500/80",
                            v != null && v > 0 && "text-slate-500",
                            v != null && v === 0 && "text-slate-300",
                            v == null && "text-slate-300 italic",
                          )}
                        >
                          {fmtPct(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function getRowStyle(variant: RowDef["variant"]) {
  switch (variant) {
    case "sum":
      return {
        prefix: "(+)",
        labelClass: "py-2 text-slate-700",
        valueClass: "py-2",
      };
    case "sub":
      return {
        prefix: "(-)",
        labelClass: "py-2 text-slate-700",
        valueClass: "py-2",
      };
    case "bold":
      return {
        prefix: null,
        labelClass: "py-2.5 font-semibold text-slate-900",
        valueClass: "py-2.5 font-semibold text-slate-900",
      };
    case "highlight":
      return {
        prefix: null,
        labelClass: "py-3 font-bold text-slate-900 uppercase text-xs tracking-wider",
        valueClass: "py-3 font-bold text-slate-900",
      };
  }
}

/**
 * Vista comparativa: line chart de evolucion + tabla del ultimo punto.
 */
/**
 * ComparativoView — vista de comparacion estilo consultora Big 4.
 * Estructura en 5 capas de storytelling:
 *   1. Executive Summary — findings clave automaticos
 *   2. Ranking horizontal con bandas de cuartiles + linea promedio
 *   3. Line chart con banda de peers (min-max area + promedio dashed)
 *   4. Small multiples — 3 mini charts side-by-side (PE, Margen, Rendimiento)
 *   5. Gap analysis table con deltas vs promedio + rank
 */

type MetricaKey = "pctPuntoEq" | "pctMargenNeto" | "pctRendimiento";

const METRICA_LABELS: Record<MetricaKey, string> = {
  pctPuntoEq: "Punto de Equilibrio",
  pctMargenNeto: "Margen Neto",
  pctRendimiento: "Rendimiento de Cartera",
};

/**
 * Un metrica es 'higher is better' o 'lower is better' segun contexto:
 *   - Rendimiento: HIGHER is better (cobras mas)
 *   - Margen: HIGHER is better
 *   - PE: LOWER is better (menor break-even = mas eficiente)
 */
const METRICA_HIGHER_IS_BETTER: Record<MetricaKey, boolean> = {
  pctPuntoEq: false,
  pctMargenNeto: true,
  pctRendimiento: true,
};

// ============================================================================
// TablaComparativaCierre — tabla estilo Excel del analista Juan Jose:
// filas = componentes del PE, columnas = entidades del peer group.
// Muestra el ULTIMO periodo de la serie (util en modo cierre unico
// pero tambien en modo historico para comparar el cierre mas reciente).
// ============================================================================

function TablaComparativaCierre({ series }: { series: PuntoEquilibrioSerie[] }) {
  if (series.length === 0) return null;
  // Ultimo periodo = el mas reciente en la serie de cualquiera (todos tienen
  // los mismos periodos). Si series[0] esta vacio, no hay data.
  const primerSerie = series[0]!;
  const ultimoPunto = primerSerie.puntos[primerSerie.puntos.length - 1];
  if (!ultimoPunto) return null;
  const periodoLabel = ultimoPunto.periodoLabel;

  // Componentes en orden Excel: Rendimiento, Otros, GF, Prov, GO, Margen, PE.
  // Los signos y tooltips se manejan igual que en la tabla historica.
  const componentes: Array<{
    label: string;
    field: "pctRendimiento" | "pctOtros" | "pctCostoFondeo" | "pctProvisiones" | "pctGastosOp" | "pctMargenNeto" | "pctPuntoEq";
    variant: "sum" | "sub" | "bold" | "highlight";
  }> = [
    { label: "Rendimiento de cartera", field: "pctRendimiento", variant: "sum" },
    { label: "Otros Ingresos (Egresos)", field: "pctOtros", variant: "sum" },
    { label: "Gasto Financiero", field: "pctCostoFondeo", variant: "sub" },
    { label: "Costo de Provisión", field: "pctProvisiones", variant: "sub" },
    { label: "Gastos Operacionales", field: "pctGastosOp", variant: "sub" },
    { label: "Margen antes de Impuestos", field: "pctMargenNeto", variant: "bold" },
    { label: "Punto de Equilibrio", field: "pctPuntoEq", variant: "highlight" },
  ];

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Cuadro comparativo por entidad
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cierre <strong>{periodoLabel}</strong> — valores anualizados (últimos 12 meses móviles), % sobre cartera promedio.
          </p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-white">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider sticky left-0 bg-slate-900 z-10 min-w-[220px]">
                Componente
              </th>
              {series.map((s) => (
                <th
                  key={s.entidad}
                  className={cn(
                    "text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider min-w-[130px] whitespace-nowrap",
                    s.esPropio && "bg-brand-700",
                  )}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    {s.entidad}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {componentes.map((c, idx) => {
              const isHighlight = c.variant === "highlight";
              const isBold = c.variant === "bold";
              const isSum = c.variant === "sum";
              const isSub = c.variant === "sub";
              return (
                <tr
                  key={c.field}
                  className={cn(
                    idx > 0 && "border-t border-slate-100",
                    isBold && "border-t border-slate-200 bg-slate-50",
                    isHighlight && "border-t-2 border-slate-800 bg-brand-50",
                    !isBold && !isHighlight && "hover:bg-slate-50",
                  )}
                >
                  <td
                    className={cn(
                      "px-4 py-2 sticky left-0 z-10",
                      isBold && "bg-slate-50 font-bold text-slate-900",
                      isHighlight && "bg-brand-50 font-bold text-slate-900",
                      !isBold && !isHighlight && "bg-white",
                      isSum && "text-slate-700",
                      isSub && "text-slate-600 pl-6 text-[13px]",
                    )}
                  >
                    {c.label}
                  </td>
                  {series.map((s) => {
                    const ult = s.puntos[s.puntos.length - 1];
                    const raw = ult ? (ult[c.field] as number | null) : null;
                    // Para PE recomputamos con la formula del analista.
                    const v = c.field === "pctPuntoEq" && ult
                      ? computedPuntoEq(ult)
                      : raw;
                    return (
                      <td
                        key={s.entidad}
                        className={cn(
                          "text-right px-3 py-2 font-mono tabular-nums whitespace-nowrap",
                          isBold && "font-bold text-slate-900 bg-slate-50",
                          isHighlight && "font-bold text-slate-900 bg-brand-50",
                          !isBold && !isHighlight && s.esPropio && "bg-brand-50/50",
                          isSum && v != null && v >= 0 && "text-emerald-700",
                          isSub && v != null && v < 0 && "text-rose-700",
                          v == null && "text-slate-400 italic",
                        )}
                      >
                        {fmtPct(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparativoView({
  series: seriesRaw,
  entidadActual,
  draftPeerGroup,
  entidadesDisponibles,
  onChangePeers,
  onAddEntidadAlComparativo,
}: {
  series: PuntoEquilibrioSerie[];
  entidadActual: string;
  draftPeerGroup: string[];
  entidadesDisponibles: EntidadDisponible[];
  onChangePeers: (nuevos: string[]) => void;
  onAddEntidadAlComparativo: () => void;
}) {
  // Recomputamos pctPuntoEq en cada punto con la formula del analista
  // (Juan Jose): PE = |Otros + GF + Prov + GO|. Todos los children que
  // consumen `series` (chart, ranking, tablas, ejecutivo) reciben ya el
  // valor correcto — una sola fuente de verdad, no hay que tocar cada uno.
  const series = useMemo(
    () =>
      seriesRaw.map((s) => ({
        ...s,
        puntos: s.puntos.map((p) => ({
          ...p,
          pctPuntoEq: computedPuntoEq(p),
        })),
      })),
    [seriesRaw],
  );

  const [metrica, setMetrica] = useState<MetricaKey>("pctPuntoEq");
  const [peerModalOpen, setPeerModalOpen] = useState(false);
  const entidadIncluida = series.some((s) => s.esPropio);

  return (
    <section className="space-y-4">
      {/* Control del peer group SOLO aqui — antes estaba mezclado con los
          selectores globales, ahora vive en el tab que realmente lo usa. */}
      <PeerGroupControl
        peerGroup={draftPeerGroup}
        onChangePeers={onChangePeers}
        onOpenModal={() => setPeerModalOpen(true)}
      />

      {peerModalOpen && (
        <PeerGroupModal
          disponibles={entidadesDisponibles}
          seleccionados={draftPeerGroup}
          onSave={(nuevos) => {
            onChangePeers(nuevos);
            setPeerModalOpen(false);
          }}
          onClose={() => setPeerModalOpen(false)}
        />
      )}

      {series.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg p-12 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700 mb-1">
            Agrega entidades para comparar
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Usa el botón &quot;Editar comparación&quot; de arriba para elegir las entidades y luego <strong>Aplicar filtros</strong>.
          </p>
        </div>
      ) : (
        <>
          {/* Selector de metrica (afecta ranking + line chart principal) */}
          <MetricaSelector metrica={metrica} onChange={setMetrica} />

          {/* Banner CTA si la entidad principal NO esta en el comparativo */}
          {!entidadIncluida && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              Tu entidad <span className="font-mono">{entidadActual}</span> no está en el comparativo
            </p>
            <p className="text-xs text-amber-800 mt-1">
              Los rankings y análisis abajo muestran solo las {series.length} entidades del peer group.
              Agrega tu entidad principal para verte dentro del ranking y su delta vs promedio.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddEntidadAlComparativo}
            className="flex-shrink-0 h-9 px-4 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-md shadow-sm whitespace-nowrap"
          >
            Agregar {entidadActual.length > 20 ? "al comparativo" : `"${entidadActual}"`}
          </button>
        </div>
      )}

          {/* CAPA 1: Executive Summary */}
          <ExecutiveSummary series={series} metrica={metrica} entidadActual={entidadActual} />

          {/* CAPA 2: Ranking horizontal con quartiles */}
          <RankingChart series={series} metrica={metrica} />

          {/* CAPA 3: Line chart con banda de peers */}
          <LineChartConBanda series={series} metrica={metrica} />

          {/* CAPA 4: Small multiples — las 3 metricas juntas */}
          <SmallMultiples series={series} />

          {/* CAPA 5: Gap analysis table */}
          <GapAnalysisTable series={series} />
        </>
      )}
    </section>
  );
}

function MetricaSelector({
  metrica,
  onChange,
}: {
  metrica: MetricaKey;
  onChange: (m: MetricaKey) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-3 flex-wrap">
      <span className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
        Métrica principal:
      </span>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-md">
        {(Object.keys(METRICA_LABELS) as MetricaKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              "px-3 h-8 text-xs font-medium rounded transition-colors",
              metrica === k
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            {METRICA_LABELS[k]}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-slate-500 ml-auto italic">
        {METRICA_HIGHER_IS_BETTER[metrica] ? "↑ Mejor cuanto más alto" : "↓ Mejor cuanto más bajo"}
      </span>
    </div>
  );
}

/**
 * Calcula estadisticas del set: min, max, promedio, mediana, rank de propia,
 * mejor/peor performer, delta vs promedio de propia. Se computa una sola
 * vez con useMemo y se pasa a los componentes que la necesitan.
 */
type StatsResult = {
  values: Array<{ entidad: string; color: string; esPropio: boolean; value: number | null }>;
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  best: { entidad: string; value: number } | null;
  worst: { entidad: string; value: number } | null;
  propia: { entidad: string; value: number | null; rank: number | null; deltaVsAvg: number | null } | null;
};

function computeStats(
  series: PuntoEquilibrioSerie[],
  metrica: MetricaKey,
): StatsResult {
  const values = series.map((s) => {
    const ult = s.puntos[s.puntos.length - 1];
    return {
      entidad: s.entidad,
      color: s.color,
      esPropio: s.esPropio,
      value: ult?.[metrica] == null ? null : (ult[metrica] as number),
    };
  });
  const nums = values.map((v) => v.value).filter((v): v is number => v != null);
  if (nums.length === 0) {
    return { values, min: null, max: null, avg: null, median: null, best: null, worst: null, propia: null };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
    : sorted[Math.floor(sorted.length / 2)]!;

  const higherIsBetter = METRICA_HIGHER_IS_BETTER[metrica];
  // Ranking: si higher is better, mayor valor = mejor (rank 1)
  const withRank = values
    .map((v) => ({ ...v }))
    .sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return higherIsBetter ? b.value - a.value : a.value - b.value;
    });
  const rankByEntidad = new Map<string, number>();
  withRank.forEach((v, i) => rankByEntidad.set(v.entidad, i + 1));

  const best = higherIsBetter
    ? values.find((v) => v.value === max)
    : values.find((v) => v.value === min);
  const worst = higherIsBetter
    ? values.find((v) => v.value === min)
    : values.find((v) => v.value === max);

  const propiaRaw = values.find((v) => v.esPropio);
  const propia = propiaRaw
    ? {
        entidad: propiaRaw.entidad,
        value: propiaRaw.value,
        rank: rankByEntidad.get(propiaRaw.entidad) ?? null,
        deltaVsAvg: propiaRaw.value != null ? propiaRaw.value - avg : null,
      }
    : null;

  return {
    values,
    min,
    max,
    avg,
    median,
    best: best && best.value != null ? { entidad: best.entidad, value: best.value } : null,
    worst: worst && worst.value != null ? { entidad: worst.entidad, value: worst.value } : null,
    propia,
  };
}

/**
 * CAPA 1 — Executive Summary. Findings clave en 3-4 tiles.
 */
function ExecutiveSummary({
  series,
  metrica,
  entidadActual,
}: {
  series: PuntoEquilibrioSerie[];
  metrica: MetricaKey;
  entidadActual: string;
}) {
  const stats = useMemo(() => computeStats(series, metrica), [series, metrica]);
  const higherIsBetter = METRICA_HIGHER_IS_BETTER[metrica];

  if (stats.avg == null) {
    return null;
  }

  const propiaMejor = stats.propia?.deltaVsAvg != null
    ? (higherIsBetter ? stats.propia.deltaVsAvg > 0 : stats.propia.deltaVsAvg < 0)
    : null;

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-lg p-5 shadow-sm">
      <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-3">
        Resumen ejecutivo · {METRICA_LABELS[metrica]}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryTile
          label="Mejor performer"
          value={stats.best ? fmtPct(stats.best.value) : "—"}
          sub={stats.best?.entidad ?? ""}
          accent="emerald"
        />
        <SummaryTile
          label="Peor performer"
          value={stats.worst ? fmtPct(stats.worst.value) : "—"}
          sub={stats.worst?.entidad ?? ""}
          accent="rose"
        />
        <SummaryTile
          label={`Promedio (${series.length} entidades)`}
          value={fmtPct(stats.avg)}
          sub={`Mediana ${fmtPct(stats.median)}`}
          accent="slate"
        />
        {stats.propia && stats.propia.value != null && stats.propia.rank != null ? (
          <SummaryTile
            label={`Tu posición · ${entidadActual}`}
            value={`#${stats.propia.rank} de ${series.length}`}
            sub={
              stats.propia.deltaVsAvg != null
                ? `${propiaMejor ? "▲" : "▼"} ${fmtPctAbs(stats.propia.deltaVsAvg)} vs promedio`
                : ""
            }
            accent={propiaMejor ? "emerald" : "rose"}
          />
        ) : (
          /* Cuando la entidad principal NO esta en el peer group, en vez
           * de un tile confuso 'No incluida', mostramos el SPREAD como
           * cuarta metrica util (rango max-min). El banner arriba ya
           * explica el caso y ofrece el CTA para agregarla. */
          <SummaryTile
            label="Spread del grupo"
            value={stats.max != null && stats.min != null ? fmtPct(stats.max - stats.min) : "—"}
            sub={`Diferencia mejor vs peor performer`}
            accent="slate"
          />
        )}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "emerald" | "rose" | "slate";
}) {
  const accentClass = {
    emerald: "text-emerald-400",
    rose: "text-rose-400",
    slate: "text-slate-100",
  }[accent];
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 font-medium">
        {label}
      </p>
      <p className={cn("text-2xl font-bold tabular-nums", accentClass)}>
        {value}
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>
    </div>
  );
}

/**
 * CAPA 2 — Ranking horizontal con quartiles y linea promedio.
 * Ordenado del mejor al peor segun higher/lower is better de la metrica.
 */
function RankingChart({
  series,
  metrica,
}: {
  series: PuntoEquilibrioSerie[];
  metrica: MetricaKey;
}) {
  const stats = useMemo(() => computeStats(series, metrica), [series, metrica]);
  const higherIsBetter = METRICA_HIGHER_IS_BETTER[metrica];

  const ranked = useMemo(() => {
    return [...stats.values]
      .filter((v) => v.value != null)
      .sort((a, b) => {
        if (higherIsBetter) return (b.value ?? 0) - (a.value ?? 0);
        return (a.value ?? 0) - (b.value ?? 0);
      });
  }, [stats, higherIsBetter]);

  if (stats.min == null || stats.max == null) return null;

  // Rango de la barra: dar 10% de padding
  const range = stats.max - stats.min;
  const padding = range === 0 ? Math.abs(stats.max) * 0.1 || 0.01 : range * 0.1;
  const barMin = stats.min - padding;
  const barMax = stats.max + padding;
  const barRange = barMax - barMin;

  // Posicion del promedio como % del ancho del bar
  const avgPct = stats.avg != null ? ((stats.avg - barMin) / barRange) * 100 : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Ranking al último periodo — {METRICA_LABELS[metrica]}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Ordenado del mejor al peor. La línea vertical marca el promedio del grupo.
        </p>
      </header>
      <div className="space-y-2">
        {ranked.map((v, i) => {
          const value = v.value!;
          const isBetterThanAvg = stats.avg != null
            ? (higherIsBetter ? value >= stats.avg : value <= stats.avg)
            : true;
          const widthPct = ((value - barMin) / barRange) * 100;
          return (
            <div key={v.entidad} className="grid grid-cols-[32px_180px_1fr_80px] items-center gap-3">
              <div className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full font-bold text-xs",
                i === 0 && "bg-emerald-100 text-emerald-800",
                i === ranked.length - 1 && ranked.length > 1 && "bg-rose-100 text-rose-800",
                i !== 0 && !(i === ranked.length - 1 && ranked.length > 1) && "bg-slate-100 text-slate-600",
              )}>
                {i + 1}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
                  <span className={cn(
                    "text-xs truncate",
                    v.esPropio ? "font-bold text-slate-900" : "text-slate-700",
                  )}>
                    {v.entidad}
                  </span>
                  {v.esPropio && (
                    <span className="text-[9px] px-1 py-0.5 bg-brand-600 text-white rounded font-bold flex-shrink-0">
                      PROPIA
                    </span>
                  )}
                </div>
              </div>
              <div className="relative h-6 bg-slate-100 rounded overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded transition-all",
                    isBetterThanAvg ? "bg-emerald-500/70" : "bg-rose-400/70",
                    v.esPropio && "ring-2 ring-brand-500 ring-inset",
                  )}
                  style={{ width: `${widthPct}%` }}
                />
                {/* Linea promedio */}
                {avgPct != null && (
                  <div
                    className="absolute inset-y-0 border-l-2 border-dashed border-slate-700"
                    style={{ left: `${avgPct}%` }}
                    title={`Promedio: ${fmtPct(stats.avg)}`}
                  />
                )}
              </div>
              <div className="text-right font-mono tabular-nums text-xs font-semibold text-slate-900">
                {fmtPct(value)}
              </div>
            </div>
          );
        })}
      </div>
      {avgPct != null && (
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-slate-700" style={{ borderTop: "2px dashed #334155" }} />
            Promedio del grupo: <strong className="text-slate-700 font-mono">{fmtPct(stats.avg)}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500/70" />
            Mejor que promedio
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-400/70" />
            Peor que promedio
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * CAPA 3 — Line chart con banda de peers.
 * Muestra: 1 linea por entidad + area gris del min-max + linea dashed
 * del promedio del grupo por periodo.
 */
function LineChartConBanda({
  series,
  metrica,
}: {
  series: PuntoEquilibrioSerie[];
  metrica: MetricaKey;
}) {
  // chartData con min, max, avg por periodo
  const chartData = useMemo(() => {
    const periodos = series[0]?.puntos.map((p) => ({ periodo: p.periodo, label: p.periodoLabel })) ?? [];
    return periodos.map(({ periodo, label }) => {
      const valores: number[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: Record<string, any> = { periodo, periodoLabel: label };
      for (const s of series) {
        const punto = s.puntos.find((p) => p.periodo === periodo);
        const v = punto?.[metrica] == null ? null : (punto[metrica] as number) * 100;
        row[s.entidad] = v;
        if (v != null) valores.push(v);
      }
      if (valores.length > 0) {
        row.__min = Math.min(...valores);
        row.__max = Math.max(...valores);
        row.__avg = valores.reduce((a, b) => a + b, 0) / valores.length;
      }
      return row;
    });
  }, [series, metrica]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Evolución temporal — {METRICA_LABELS[metrica]}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Cada línea es una entidad. El área sombreada gris marca el rango peer (mín-máx) y la línea punteada el promedio del grupo por periodo.
        </p>
      </header>
      <div style={{ width: "100%", height: 400 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 40, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="periodoLabel"
              tick={{ fontSize: 11, fill: "#64748b" }}
              angle={-30}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              width={60}
            />
            <Tooltip
              formatter={(v: number, name: string) => {
                if (name.startsWith("__")) return ["", ""];
                return [`${v.toFixed(2)}%`, name];
              }}
              labelStyle={{ fontWeight: 700, color: "#0f172a" }}
              contentStyle={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
              formatter={(v) => (v.startsWith("__") ? "" : v)}
            />
            {/* Linea promedio del grupo (dashed gris oscuro) */}
            <Line
              dataKey="__avg"
              name="Promedio grupo"
              stroke="#475569"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            {series.map((s) => (
              <Line
                key={s.entidad}
                type="monotone"
                dataKey={s.entidad}
                stroke={s.color}
                strokeWidth={s.esPropio ? 3 : 2}
                dot={{ r: s.esPropio ? 5 : 3, strokeWidth: 1 }}
                activeDot={{ r: 6 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * CAPA 4 — Small multiples. 3 mini charts side-by-side, una por metrica.
 * El usuario ve todas las metricas de un solo tiro sin cambiar de tab.
 */
function SmallMultiples({ series }: { series: PuntoEquilibrioSerie[] }) {
  const metricas: MetricaKey[] = ["pctRendimiento", "pctPuntoEq", "pctMargenNeto"];
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Vista integral — 3 métricas en paralelo
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Ve la trayectoria de las 3 métricas clave sin cambiar de vista. Ideal para detectar correlaciones (ej: baja de rendimiento + suba de PE = margen colapsando).
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {metricas.map((m) => (
          <MiniLineChart key={m} series={series} metrica={m} />
        ))}
      </div>
    </div>
  );
}

function MiniLineChart({
  series,
  metrica,
}: {
  series: PuntoEquilibrioSerie[];
  metrica: MetricaKey;
}) {
  const chartData = useMemo(() => {
    const periodos = series[0]?.puntos.map((p) => p.periodo) ?? [];
    return periodos.map((periodo) => {
      const row: Record<string, number | string | null> = { periodo };
      for (const s of series) {
        const p = s.puntos.find((pt) => pt.periodo === periodo);
        row[s.entidad] = p?.[metrica] == null ? null : (p[metrica] as number) * 100;
      }
      return row;
    });
  }, [series, metrica]);

  return (
    <div className="border border-slate-100 rounded-lg p-3">
      <p className="text-xs font-semibold text-slate-700 text-center mb-2">
        {METRICA_LABELS[metrica]}
      </p>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="2 3" stroke="#f1f5f9" />
            <YAxis
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
              width={30}
            />
            <XAxis dataKey="periodo" hide />
            <Tooltip
              formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name]}
              contentStyle={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 4,
                fontSize: 10,
                padding: "4px 8px",
              }}
            />
            {series.map((s) => (
              <Line
                key={s.entidad}
                type="monotone"
                dataKey={s.entidad}
                stroke={s.color}
                strokeWidth={s.esPropio ? 2.5 : 1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * CAPA 5 — Gap Analysis Table.
 * Cada entidad con las 3 metricas + delta vs promedio + rank en cada una.
 * Color coding: verde si mejor que promedio, rojo si peor.
 */
function GapAnalysisTable({ series }: { series: PuntoEquilibrioSerie[] }) {
  const rows = useMemo(() => {
    return series.map((s) => {
      const ult = s.puntos[s.puntos.length - 1];
      // PE recomputado con formula del analista (Juan Jose):
      // PE = |Otros + Gasto Financiero + Costo Prov + Gastos Op|.
      // Coincide con el helper computedPuntoEq usado en la tabla historica.
      const puntoEqRecalc = ult ? computedPuntoEq(ult) : null;
      return {
        entidad: s.entidad,
        color: s.color,
        esPropio: s.esPropio,
        rendimiento: ult?.pctRendimiento ?? null,
        puntoEq: puntoEqRecalc,
        margen: ult?.pctMargenNeto ?? null,
      };
    });
  }, [series]);

  const avg = useMemo(() => {
    const collect = (key: "rendimiento" | "puntoEq" | "margen"): number[] => {
      const out: number[] = [];
      for (const r of rows) {
        const v = r[key];
        if (typeof v === "number") out.push(v);
      }
      return out;
    };
    const mean = (arr: number[]): number | null =>
      arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      rendimiento: mean(collect("rendimiento")),
      puntoEq: mean(collect("puntoEq")),
      margen: mean(collect("margen")),
    };
  }, [rows]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <h2 className="text-sm font-semibold text-slate-900">
          Gap Analysis — snapshot al último periodo
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Cada métrica con su delta vs promedio del grupo. Verde = mejor, rojo = peor.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-700">Entidad</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Rendimiento</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-500">Δ vs prom</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Punto Equilibrio</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-500">Δ vs prom</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Margen Neto</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-500">Δ vs prom</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.entidad}
                className={cn(
                  "border-t border-slate-100",
                  r.esPropio && "bg-brand-50/50 font-semibold",
                )}
              >
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.entidad}
                    {r.esPropio && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-brand-600 text-white rounded font-bold">
                        PROPIA
                      </span>
                    )}
                  </span>
                </td>
                <td className="text-right px-3 py-2 font-mono tabular-nums text-slate-900">
                  {fmtPct(r.rendimiento)}
                </td>
                <DeltaCell value={r.rendimiento} avg={avg.rendimiento} higherIsBetter />
                <td className="text-right px-3 py-2 font-mono tabular-nums font-bold text-slate-900">
                  {fmtPct(r.puntoEq)}
                </td>
                <DeltaCell value={r.puntoEq} avg={avg.puntoEq} higherIsBetter={false} />
                <td className="text-right px-3 py-2 font-mono tabular-nums text-slate-900">
                  {fmtPct(r.margen)}
                </td>
                <DeltaCell value={r.margen} avg={avg.margen} higherIsBetter />
              </tr>
            ))}
            {/* Fila de promedio */}
            <tr className="border-t-2 border-slate-800 bg-slate-100">
              <td className="px-4 py-2 font-semibold text-slate-900 uppercase text-[10px] tracking-wider">
                Promedio del grupo
              </td>
              <td className="text-right px-3 py-2 font-mono tabular-nums font-bold text-slate-900">
                {fmtPct(avg.rendimiento)}
              </td>
              <td />
              <td className="text-right px-3 py-2 font-mono tabular-nums font-bold text-slate-900">
                {fmtPct(avg.puntoEq)}
              </td>
              <td />
              <td className="text-right px-3 py-2 font-mono tabular-nums font-bold text-slate-900">
                {fmtPct(avg.margen)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeltaCell({
  value,
  avg,
  higherIsBetter,
}: {
  value: number | null;
  avg: number | null;
  higherIsBetter: boolean;
}) {
  if (value == null || avg == null) {
    return <td className="text-right px-3 py-2 text-slate-400 italic">—</td>;
  }
  const delta = value - avg;
  const isBetter = higherIsBetter ? delta > 0 : delta < 0;
  const isNeutral = Math.abs(delta) < 0.0001;
  return (
    <td className="text-right px-3 py-2 font-mono tabular-nums">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold",
          isNeutral && "text-slate-500",
          !isNeutral && isBetter && "bg-emerald-100 text-emerald-800",
          !isNeutral && !isBetter && "bg-rose-100 text-rose-800",
        )}
      >
        {!isNeutral && (isBetter ? "▲" : "▼")}
        {fmtPctAbs(delta)}
      </span>
    </td>
  );
}

/**
 * Formato de porcentaje ABSOLUTO — para deltas donde el signo lo
 * codificamos con flecha ▲/▼ en vez de - / +.
 */
function fmtPctAbs(v: number | null): string {
  if (v == null) return "—";
  return `${(Math.abs(v) * 100).toFixed(2)}%`;
}

function EmptyState() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
      <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-600">Sin datos disponibles para los filtros seleccionados.</p>
    </div>
  );
}

/**
 * Formato de porcentaje. Los valores del view v_punto_equilibrio_ancho
 * estan en formato DECIMAL (0.0963 = 9.63%). Multiplicamos x100 aca.
 */
function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const n = Number(v) * 100;
  const abs = Math.abs(n);
  return n < 0 ? `-${abs.toFixed(2)}%` : `${n.toFixed(2)}%`;
}

/**
 * InfoTooltip — ícono ℹ️ con popover al hover/click. Sustituye a los
 * info banners grandes que ocupan espacio. El contenido es JSX para
 * permitir formato rico (strong, links, listas).
 *
 * Comportamiento: hover en desktop, tap en mobile (toggle click).
 * Cierra al mouse leave o click fuera.
 */
function InfoTooltip({ content }: { content: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors focus:outline-none"
        aria-label="Más información"
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs text-slate-700 leading-relaxed"
        >
          {/* Arrow */}
          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white border-l border-t border-slate-200" />
          <div className="relative">{content}</div>
        </div>
      )}
    </span>
  );
}

/**
 * PeerGroupControl — chips del peer group + boton 'Editar comparación'.
 * Vive dentro del tab Comparativo, no en los selectores globales.
 * Cambios se aplican via el mismo 'Aplicar filtros' arriba.
 */
function PeerGroupControl({
  peerGroup,
  onChangePeers,
  onOpenModal,
}: {
  peerGroup: string[];
  onChangePeers: (nuevos: string[]) => void;
  onOpenModal: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1 mb-2">
            <Users className="w-3 h-3" />
            Entidades a comparar ({peerGroup.length})
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {peerGroup.length === 0 ? (
              <span className="text-xs text-slate-500 italic">
                Sin entidades seleccionadas. Click en &quot;Editar comparación&quot; para agregar.
              </span>
            ) : (
              peerGroup.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 border border-slate-200 rounded"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => onChangePeers(peerGroup.filter((x) => x !== p))}
                    className="text-slate-400 hover:text-rose-600"
                    title="Quitar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenModal}
          className="h-9 px-4 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-md shadow-sm inline-flex items-center gap-2"
        >
          <Users className="w-4 h-4" />
          Editar comparación
        </button>
      </div>
      <p className="text-[11px] text-slate-500 italic mt-3 pt-3 border-t border-slate-100">
        Los cambios en las entidades requieren <strong>Aplicar filtros</strong> arriba para
        actualizar los gráficos y tablas.
      </p>
    </div>
  );
}
