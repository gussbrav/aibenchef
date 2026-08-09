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

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { Sparkles, Users, Calendar, X, Plus, Loader2, Paintbrush, Wand2 } from "lucide-react";

import type { DupontData, DupontRow } from "@/lib/domains/dupont";
import type { EntidadDisponible } from "@/lib/domains/informe";
import { ColorPickerPopover } from "@/app/dashboard/informe/color-picker-popover";

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

// ============================================================================
// Componente raiz
// ============================================================================

export function DupontClient({
  data,
  periodosDisponibles,
  entidadesDisponibles,
  consolidar: _consolidar,
}: {
  data: DupontData;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
  consolidar: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Draft state — cambios no aplicados aún
  const initialEntidades = data.entidades.map((e) => e.nombCorreg);
  const initialPeriodos = data.periodos.map((p) => p.codigo);
  // Map<nombCorreg, hex> con los colores override vivos (client-side).
  // Los cambios de color se aplican INMEDIATAMENTE al render (setState)
  // ademas de persistir en URL para que sobrevivan la navegacion.
  const initialColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data.entidades) m.set(e.nombCorreg, e.color);
    return m;
  }, [data.entidades]);
  const [draftEntidades, setDraftEntidades] = useState<string[]>(initialEntidades);
  const [draftPeriodos, setDraftPeriodos] = useState<number[]>(initialPeriodos);
  const [liveColors, setLiveColors] = useState<Map<string, string>>(initialColors);

  const dirty = useMemo(() => {
    if (draftEntidades.length !== initialEntidades.length) return true;
    if (draftPeriodos.length !== initialPeriodos.length) return true;
    for (let i = 0; i < draftEntidades.length; i++) {
      if (draftEntidades[i] !== initialEntidades[i]) return true;
    }
    for (let i = 0; i < draftPeriodos.length; i++) {
      if (draftPeriodos[i] !== initialPeriodos[i]) return true;
    }
    return false;
  }, [draftEntidades, initialEntidades, draftPeriodos, initialPeriodos]);

  // Al aplicar filtros persistimos entidades + periodos. Colores se persisten
  // por separado (cambio de color debe ser instantaneo, no requiere apply).
  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("entidades", draftEntidades.join(","));
    params.set("periodos", draftPeriodos.join(","));
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}` as never, { scroll: false });
    });
  }, [draftEntidades, draftPeriodos, pathname, router, searchParams]);

  const resetFilters = useCallback(() => {
    setDraftEntidades(initialEntidades);
    setDraftPeriodos(initialPeriodos);
  }, [initialEntidades, initialPeriodos]);

  // Setear color de una entidad: (a) update local instant + (b) push URL
  // con ?colors=... para que persista. hex=null resetea al color del server.
  const setColorForEntity = useCallback(
    (nombCorreg: string, hex: string | null) => {
      setLiveColors((prev) => {
        const next = new Map(prev);
        if (hex) next.set(nombCorreg, hex);
        else {
          const server = initialColors.get(nombCorreg);
          if (server) next.set(nombCorreg, server);
          else next.delete(nombCorreg);
        }
        return next;
      });
      // Persistir en URL — solo los overrides que difieren del server-default
      const params = new URLSearchParams(searchParams.toString());
      const overrides: string[] = [];
      const target = new Map(liveColors);
      if (hex) target.set(nombCorreg, hex);
      else target.delete(nombCorreg);
      for (const [n, c] of target.entries()) {
        const serverColor = initialColors.get(n);
        if (serverColor && c.toLowerCase() !== serverColor.toLowerCase()) {
          overrides.push(`${n}:${c.replace(/^#/, "")}`);
        }
      }
      if (overrides.length > 0) params.set("colors", overrides.join(","));
      else params.delete("colors");
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}` as never, { scroll: false });
      });
    },
    [initialColors, liveColors, pathname, router, searchParams],
  );

  // Data con colores en vivo aplicados (para que los charts reaccionen sin
  // esperar la navegacion server-side)
  const dataConColores = useMemo(
    () => ({
      ...data,
      entidades: data.entidades.map((e) => ({
        ...e,
        color: liveColors.get(e.nombCorreg) ?? e.color,
      })),
    }),
    [data, liveColors],
  );

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
  // 1 sola llamada a /api/v1/dupont/insights que devuelve los 4 arrays de
  // bullets (roe, roa, mon, mfb). Loading state + fallback a determinista.
  const narrativaIA = useNarrativaIA(data);

  return (
    <div className="max-w-7xl mx-auto space-y-6 px-2 animate-premium-in">
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
        draftPeriodos={draftPeriodos}
        setDraftPeriodos={setDraftPeriodos}
        entidadesDisponibles={entidadesDisponibles}
        periodosDisponibles={periodosDisponibles}
        colorByEnt={colorByEnt}
        onColorChange={setColorForEntity}
        dirty={dirty}
        isPending={isPending}
        onApply={applyFilters}
        onReset={resetFilters}
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
        <strong>Metodología:</strong> ratios TTM (últimos 12 meses) sobre activo
        promedio 12M. Fuente: Superintendencia de Banca, Seguros y AFP (SBS Perú).
        Convención de signos: los gastos se muestran con signo negativo para que
        se sumen algebraicamente con los ingresos y respeten el árbol DuPont
        clásico (ROE = ROA × Apalancamiento; ROA = MON + Otros + Impuestos; etc.).
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
  draftPeriodos,
  setDraftPeriodos,
  entidadesDisponibles,
  periodosDisponibles,
  colorByEnt,
  onColorChange,
  dirty,
  isPending,
  onApply,
  onReset,
}: {
  draftEntidades: string[];
  setDraftEntidades: (v: string[]) => void;
  draftPeriodos: number[];
  setDraftPeriodos: (v: number[]) => void;
  entidadesDisponibles: EntidadDisponible[];
  periodosDisponibles: number[];
  colorByEnt: Map<string, string>;
  onColorChange: (nombCorreg: string, hex: string | null) => void;
  dirty: boolean;
  isPending: boolean;
  onApply: () => void;
  onReset: () => void;
}) {
  const [entidadModalOpen, setEntidadModalOpen] = useState(false);

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
            {draftEntidades.map((n) => (
              <EntidadChipConColor
                key={n}
                nombCorreg={n}
                color={colorByEnt.get(n) ?? "#64748b"}
                onColorChange={(hex) => onColorChange(n, hex)}
                onRemove={() => removeEntidad(n)}
              />
            ))}
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

      {/* Barra de accion apply/reset */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-[11px] text-slate-500 italic">
          {dirty
            ? "Cambios pendientes — presiona Aplicar para actualizar la vista"
            : "Los filtros están sincronizados con la vista"}
        </span>
        <div className="flex gap-2">
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
  onColorChange,
  onRemove,
}: {
  nombCorreg: string;
  color: string;
  onColorChange: (hex: string | null) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const dotRef = useRef<HTMLButtonElement>(null);

  return (
    <span className="inline-flex items-center gap-1 pl-1 pr-1 py-1 text-xs rounded-full bg-slate-100 text-slate-700 border border-slate-200">
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
                <span className="flex-1 text-left">{e.nombCorreg}</span>
                <span className="text-[10px] text-slate-400">{e.tipoEntidad}</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-0">
        {/* Sidebar de narrativa — 3 estados visuales:
              loading = shimmer + spinner + "generando"
              ok (IA) = badge purple con ícono Wand2 (highlight que fue IA)
              fallback = badge slate normal (narrativa deterministica) */}
        <aside className="p-5 bg-slate-50 border-r border-slate-200 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-xs uppercase tracking-wider font-semibold text-slate-500">
              Lectura
            </h3>
            {narrativaIA.status === "loading" && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
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
          </div>
          {narrativaIA.status === "loading" ? (
            <div className="space-y-2">
              {[80, 90, 70].map((w) => (
                <div
                  key={w}
                  className="h-3 rounded bg-slate-200 animate-pulse"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : (
            narrativa.map((n, i) => (
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
            ))
          )}
        </aside>

        {/* Charts a la derecha — principal arriba, subs abajo en grid */}
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
                  : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {subIndicadores.map((s, i) => (
                <IndicadorChart key={i} def={s} data={data} rowsIndex={rowsIndex} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer sutil */}
      <div className="px-5 py-2 border-t border-slate-100 text-[10px] text-slate-500">
        Activo Promedio 12M · Fuente SBS · Valores anualizados TTM
      </div>
    </section>
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
            margin={{ top: 20, right: 8, left: 0, bottom: 4 }}
            barCategoryGap="18%"
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
              cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
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
                maxBarSize={highlight ? 46 : 34}
              >
                {highlight && (
                  <LabelList
                    dataKey={ent.nombCorreg}
                    position="top"
                    formatter={(v: unknown) => fmtValue(Number(v))}
                    style={{ fontSize: 10, fill: "#334155", fontWeight: 600 }}
                  />
                )}
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

function useNarrativaIA(data: DupontData): NarrativaState {
  const [state, setState] = useState<NarrativaState>({
    status: "loading",
    data: null,
    model: null,
  });

  // Hash simple de la data para no re-fetchear si nada cambio.
  // Basta con (entidades, periodos, valores del roePct) — si cambian
  // otros ratios sin cambiar roe, es porque cambiaron periodos.
  const dataKey = useMemo(() => {
    const ents = data.entidades.map((e) => e.nombCorreg).join("|");
    const pers = data.periodos.map((p) => p.codigo).join("|");
    const vals = data.filas
      .map((r) => `${r.entidad}:${r.periodo}:${r.roePct?.toFixed(2) ?? "-"}`)
      .join(",");
    return `${ents}#${pers}#${vals}`;
  }, [data]);

  useEffect(() => {
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
