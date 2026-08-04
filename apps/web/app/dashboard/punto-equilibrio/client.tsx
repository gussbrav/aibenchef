"use client";

/**
 * PuntoEquilibrioClient — vista completa del PE con:
 *   - Selectores: entidad, rango desde/hasta, granularidad, peer group
 *   - Tab 1: Histórico (tabla con componentes por periodo)
 *   - Tab 2: Comparativo (line chart evolucion temporal + tabla)
 *
 * URL sincronizada — selectores modifican la URL para poder compartir.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3, Calendar, Info, Layers, TrendingUp, Users, X,
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
    }),
    [entidadActual, config.desdeAnio, config.granularidad, config.hastaPeriodo, config.peerGroup],
  );

  // Estado DRAFT — el usuario edita libremente sin disparar re-fetch.
  // Se re-sincroniza con applied cuando el SSR responde (o cuando el user
  // navega con back/forward y cambian los searchParams).
  const [draft, setDraft] = useState<DraftState>(applied);

  useEffect(() => {
    setDraft(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied.entidad, applied.desdeAnio, applied.granularidad, applied.hastaPeriodo, applied.peerGroup.join(",")]);

  // Contador de cambios pendientes vs applied.
  const changeCount = useMemo(() => {
    let n = 0;
    if (draft.entidad !== applied.entidad) n++;
    if (draft.desdeAnio !== applied.desdeAnio) n++;
    if (draft.granularidad !== applied.granularidad) n++;
    if (draft.hastaPeriodo !== applied.hastaPeriodo) n++;
    if (draft.peerGroup.join(",") !== applied.peerGroup.join(",")) n++;
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
      {/* Header con branding del cliente */}
      <header
        className="rounded-xl text-white p-6 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${cliente.brand.primary} 0%, ${cliente.brand.acento} 100%)`,
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap relative z-10">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-75 mb-1">
              Análisis financiero
            </p>
            <h1 className="text-2xl md:text-3xl font-bold mb-1">Punto de Equilibrio</h1>
            <p className="text-sm opacity-90">
              {entidadActual} · Cierre {periodo.label}
            </p>
          </div>
        </div>
      </header>

      {/* Info banner */}
      <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-sky-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-sky-900">
          <p className="font-semibold mb-1">Qué es el Punto de Equilibrio</p>
          <p className="text-sky-800 leading-relaxed">
            Es el rendimiento mínimo sobre cartera que necesitas para cubrir todos los
            costos (fondeo + provisiones + gastos operacionales), en % de la cartera
            promedio 12 meses. Si tu rendimiento real supera el PE, generas margen.
          </p>
        </div>
      </div>

      {/* SELECTORES */}
      <SelectoresBar
        entidadesDisponibles={entidadesDisponibles}
        draft={draft}
        setDraft={setDraft}
        changeCount={changeCount}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-1">
          <TabButton
            active={tab === "historico"}
            onClick={() => setTab("historico")}
            icon={TrendingUp}
            label="Histórico de mi entidad"
          />
          <TabButton
            active={tab === "comparativo"}
            onClick={() => setTab("comparativo")}
            icon={Users}
            label={`Comparativo (${config.peerGroup.length})`}
          />
        </div>
      </div>

      {tab === "historico" && (
        <HistoricoTable data={historico} entidad={entidadActual} />
      )}
      {tab === "comparativo" && (
        <ComparativoView series={series} />
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

  const [peerModalOpen, setPeerModalOpen] = useState(false);
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

        {/* Desde año */}
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1 mb-1">
            <Calendar className="w-3 h-3" />
            Desde año
          </label>
          <select
            value={draft.desdeAnio}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10);
              setDraft((d) => ({ ...d, desdeAnio: v }));
            }}
            className="w-full h-9 px-2 text-sm rounded-md border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none bg-white"
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

      {/* Peer group como chips */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider flex items-center gap-1 mb-2">
              <Users className="w-3 h-3" />
              Comparar contra ({draft.peerGroup.length} entidades)
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {draft.peerGroup.length === 0 ? (
                <span className="text-xs text-slate-500 italic">
                  Sin entidades seleccionadas — click en &quot;Editar comparación&quot; para agregar.
                </span>
              ) : (
                draft.peerGroup.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 border border-slate-200 rounded"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          peerGroup: d.peerGroup.filter((x) => x !== p),
                        }))
                      }
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
            onClick={() => setPeerModalOpen(true)}
            className="h-8 px-3 text-xs font-medium bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-md shadow-sm"
          >
            Editar comparación
          </button>
        </div>
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

      {peerModalOpen && (
        <PeerGroupModal
          disponibles={entidadesDisponibles}
          seleccionados={draft.peerGroup}
          onSave={(nuevos) => {
            setDraft((d) => ({ ...d, peerGroup: nuevos }));
            setPeerModalOpen(false);
          }}
          onClose={() => setPeerModalOpen(false)}
        />
      )}
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
 * Tabla histórica: filas = componentes, columnas = periodos.
 */
function HistoricoTable({
  data, entidad,
}: { data: PuntoEquilibrioRow[]; entidad: string }) {
  if (data.length === 0) return <EmptyState />;
  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <h2 className="text-sm font-semibold text-slate-900">
          Cuadro histórico — {entidad}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Valores anualizados TTM (últimos 12 meses) sobre cartera promedio de 12 meses.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700 min-w-[220px] sticky left-0 bg-slate-100 z-10">
                Componente
              </th>
              {data.map((p) => (
                <th
                  key={p.periodo}
                  className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700 min-w-[85px] whitespace-nowrap"
                >
                  {p.periodoLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Rendimiento de cartera" prefix="(+)" data={data} field="pctRendimiento" positive />
            <Row label="Otros Ingresos (Egresos)" prefix="(+)" data={data} field="pctOtros" positive />
            <Row label="Gasto Financiero" prefix="(-)" data={data} field="pctCostoFondeo" negative />
            <Row label="Costo de Provisión" prefix="(-)" data={data} field="pctProvisiones" negative />
            <Row label="Gastos Operacionales" prefix="(-)" data={data} field="pctGastosOp" negative />
            <SeparatorRow cols={data.length + 1} />
            <RowBold label="Margen antes de Impuestos" data={data} field="pctMargenNeto" />
            <RowHighlight label="Punto de Equilibrio" data={data} field="pctPuntoEq" />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({
  label, prefix, data, field, positive, negative,
}: {
  label: string;
  prefix: "(+)" | "(-)";
  data: PuntoEquilibrioRow[];
  field: keyof PuntoEquilibrioRow;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white z-10">
        <span className="text-slate-400 font-mono mr-1">{prefix}</span>
        {label}
      </td>
      {data.map((p) => {
        const v = p[field] as number | null;
        return (
          <td
            key={p.periodo}
            className={cn(
              "text-right px-3 py-2 font-mono tabular-nums whitespace-nowrap",
              positive && v != null && "text-emerald-700",
              negative && v != null && "text-rose-700",
              v == null && "text-slate-400 italic",
            )}
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function RowBold({
  label, data, field,
}: { label: string; data: PuntoEquilibrioRow[]; field: keyof PuntoEquilibrioRow }) {
  return (
    <tr className="border-t border-slate-200 bg-slate-50">
      <td className="px-4 py-2.5 font-semibold text-slate-900 sticky left-0 bg-slate-50 z-10">
        {label}
      </td>
      {data.map((p) => {
        const v = p[field] as number | null;
        return (
          <td
            key={p.periodo}
            className="text-right px-3 py-2.5 font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap"
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function RowHighlight({
  label, data, field,
}: { label: string; data: PuntoEquilibrioRow[]; field: keyof PuntoEquilibrioRow }) {
  return (
    <tr className="border-t-2 border-slate-800 bg-brand-50">
      <td className="px-4 py-3 font-bold text-slate-900 uppercase text-xs tracking-wider sticky left-0 bg-brand-50 z-10">
        {label}
      </td>
      {data.map((p) => {
        const v = p[field] as number | null;
        return (
          <td
            key={p.periodo}
            className="text-right px-3 py-3 font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap"
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function SeparatorRow({ cols }: { cols: number }) {
  return <tr><td colSpan={cols} className="h-px bg-slate-200 p-0" /></tr>;
}

/**
 * Vista comparativa: line chart de evolucion + tabla del ultimo punto.
 */
function ComparativoView({ series }: { series: PuntoEquilibrioSerie[] }) {
  const [metrica, setMetrica] = useState<"pctPuntoEq" | "pctMargenNeto" | "pctRendimiento">(
    "pctPuntoEq",
  );
  if (series.length === 0) {
    return (
      <div className="bg-white border border-dashed border-slate-300 rounded-lg p-12 text-center">
        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-slate-700 mb-1">
          Sin entidades para comparar
        </p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Agrega al menos una entidad usando el botón &quot;Editar comparación&quot; en los selectores de arriba.
        </p>
      </div>
    );
  }

  // Recharts data: array de objects donde cada key es una entidad
  const chartData = useMemo(() => {
    const periodos = series[0]?.puntos.map((p) => p.periodo) ?? [];
    return periodos.map((periodo) => {
      const row: Record<string, number | string | null> = { periodo, periodoLabel: "" };
      for (const s of series) {
        const punto = s.puntos.find((p) => p.periodo === periodo);
        row[s.entidad] = punto?.[metrica] == null ? null : (punto[metrica] as number) * 100;
        row.periodoLabel = punto?.periodoLabel ?? "";
      }
      return row;
    });
  }, [series, metrica]);

  const metricaLabels = {
    pctPuntoEq: "Punto de Equilibrio",
    pctMargenNeto: "Margen Neto",
    pctRendimiento: "Rendimiento de Cartera",
  };

  return (
    <section className="space-y-4">
      {/* Selector de métrica */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <span className="text-xs uppercase font-semibold text-slate-500 tracking-wider">
          Métrica a graficar:
        </span>
        <div className="flex gap-1 p-1 bg-slate-100 rounded-md">
          {(Object.keys(metricaLabels) as Array<keyof typeof metricaLabels>).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetrica(k)}
              className={cn(
                "px-3 h-8 text-xs font-medium rounded transition-colors",
                metrica === k
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {metricaLabels[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Line chart */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {metricaLabels[metrica]} — evolución temporal
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Valores anualizados TTM. Compara la trayectoria de cada entidad en el rango seleccionado.
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
                formatter={(v: number) => `${v.toFixed(2)}%`}
                labelStyle={{ fontWeight: 700, color: "#0f172a" }}
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
              {series.map((s) => (
                <Line
                  key={s.entidad}
                  type="monotone"
                  dataKey={s.entidad}
                  stroke={s.color}
                  strokeWidth={s.esPropio ? 3 : 2}
                  strokeDasharray={s.esPropio ? "0" : "0"}
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

      {/* Tabla resumen ultimo periodo */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">
            Snapshot al último periodo
          </h2>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Entidad</th>
              <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Rendimiento</th>
              <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Punto Equilibrio</th>
              <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Margen Neto</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const ult = s.puntos[s.puntos.length - 1];
              return (
                <tr key={s.entidad} className={cn(
                  "border-t border-slate-100",
                  s.esPropio && "bg-brand-50/50 font-semibold",
                )}>
                  <td className="px-4 py-2 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.entidad}
                    {s.esPropio && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-brand-600 text-white rounded font-bold ml-1">
                        TU ENTIDAD
                      </span>
                    )}
                  </td>
                  <td className="text-right px-4 py-2 font-mono tabular-nums text-emerald-700">
                    {fmtPct(ult?.pctRendimiento ?? null)}
                  </td>
                  <td className="text-right px-4 py-2 font-mono tabular-nums text-slate-900 font-bold">
                    {fmtPct(ult?.pctPuntoEq ?? null)}
                  </td>
                  <td className="text-right px-4 py-2 font-mono tabular-nums text-slate-900">
                    {fmtPct(ult?.pctMargenNeto ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
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
