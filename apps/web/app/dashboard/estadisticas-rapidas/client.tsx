"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

import type {
  FilaSF,
  FilaCOOPAC,
  PeriodoItem,
  SubsistemasSF,
  NivelCOOPAC,
} from "@/lib/domains/estadisticas-rapidas";
import { LABEL_NIVEL } from "@/lib/domains/estadisticas-rapidas";
import {
  formatPct,
  formatNumberCompact,
  tipoEntidadLabel,
} from "@/app/dashboard/_lib/format";

// ============================================================================
// Props
// ============================================================================

type Props = {
  sf: FilaSF[];
  coopac: FilaCOOPAC[];
  periodoActual: number;
  periodoLabel: string;
  periodos: PeriodoItem[];
};

// ============================================================================
// Helpers
// ============================================================================

type SortDir = "asc" | "desc";
type SortState = { col: string; dir: SortDir };

function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  sort: SortState,
): T[] {
  return [...rows].sort((a, b) => {
    const av = a[sort.col];
    const bv = b[sort.col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "es");
    return sort.dir === "desc" ? -cmp : cmp;
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-slate-300 text-[10px] ml-0.5">↕</span>;
  return (
    <span className="text-brand-600 text-[10px] ml-0.5">
      {dir === "desc" ? "↓" : "↑"}
    </span>
  );
}

// ============================================================================
// Columna header clickeable
// ============================================================================

function Th({
  col,
  sort,
  onSort,
  right = false,
  children,
}: {
  col: string;
  sort: SortState;
  onSort: (col: string) => void;
  right?: boolean;
  children: React.ReactNode;
}) {
  const active = sort.col === col;
  return (
    <th
      className={`py-2 px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 ${right ? "text-right" : "text-left"}`}
      onClick={() => onSort(col)}
    >
      {children}
      <SortIcon active={active} dir={sort.dir} />
    </th>
  );
}

// ============================================================================
// Tabla SF por subsistema
// ============================================================================

const DEFAULT_SORT_SF: SortState = { col: "cartera_bruta", dir: "desc" };

function TablaSF({ rows }: { rows: FilaSF[] }) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT_SF);

  function handleSort(col: string) {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: "desc" },
    );
  }

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  if (sorted.length === 0) {
    return <p className="text-slate-400 text-sm py-2">Sin datos para este periodo.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th col="nomb_correg" sort={sort} onSort={handleSort}>Entidad</Th>
            <Th col="cartera_bruta" sort={sort} onSort={handleSort} right>Cartera Bruta</Th>
            <Th col="depositos_total" sort={sort} onSort={handleSort} right>Depósitos</Th>
            <Th col="mora_pct" sort={sort} onSort={handleSort} right>Mora</Th>
            <Th col="cobertura_pct" sort={sort} onSort={handleSort} right>Cobertura</Th>
            <Th col="castigos_12m" sort={sort} onSort={handleSort} right>Castigos 12m</Th>
            <Th col="roe_pct" sort={sort} onSort={handleSort} right>ROE</Th>
            <Th col="roa_pct" sort={sort} onSort={handleSort} right>ROA</Th>
            <Th col="rendimiento_pct" sort={sort} onSort={handleSort} right>Rendim.</Th>
            <Th col="fondeo_pct" sort={sort} onSort={handleSort} right>C. Fondeo</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((row) => (
            <tr key={row.nomb_correg} className="hover:bg-slate-50/60 transition-colors">
              <td className="py-2 px-3 font-medium text-slate-800 max-w-[220px] truncate">
                {row.nomb_correg}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.cartera_bruta)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.depositos_total)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${moraColor(row.mora_pct)}`}>
                {formatPct(row.mora_pct)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${coberturaColor(row.cobertura_pct)}`}>
                {formatPct(row.cobertura_pct)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.castigos_12m)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${roeColor(row.roe_pct)}`}>
                {formatPct(row.roe_pct)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${roeColor(row.roa_pct)}`}>
                {formatPct(row.roa_pct)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatPct(row.rendimiento_pct)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatPct(row.fondeo_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Tabla COOPAC por nivel
// ============================================================================

const DEFAULT_SORT_COOPAC: SortState = { col: "cartera_bruta", dir: "desc" };

function TablaCOOPAC({ rows }: { rows: FilaCOOPAC[] }) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT_COOPAC);

  function handleSort(col: string) {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: "desc" },
    );
  }

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  if (sorted.length === 0) {
    return <p className="text-slate-400 text-sm py-2">Sin datos para este periodo.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th col="nomb_correg" sort={sort} onSort={handleSort}>Entidad</Th>
            <Th col="cartera_bruta" sort={sort} onSort={handleSort} right>Cartera Bruta</Th>
            <Th col="depositos_sbs" sort={sort} onSort={handleSort} right>Obligac. Socios</Th>
            <Th col="total_activo" sort={sort} onSort={handleSort} right>Total Activo</Th>
            <Th col="patrimonio" sort={sort} onSort={handleSort} right>Patrimonio</Th>
            <Th col="utilidad_neta" sort={sort} onSort={handleSort} right>Utilidad Neta</Th>
            <Th col="mora_pct" sort={sort} onSort={handleSort} right>Mora</Th>
            <Th col="cobertura_pct" sort={sort} onSort={handleSort} right>Cobertura</Th>
            <Th col="roe" sort={sort} onSort={handleSort} right>ROE</Th>
            <Th col="roa" sort={sort} onSort={handleSort} right>ROA</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((row) => (
            <tr key={row.nomb_correg} className="hover:bg-slate-50/60 transition-colors">
              <td className="py-2 px-3 font-medium text-slate-800 max-w-[220px] truncate">
                {row.nomb_correg}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.cartera_bruta)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.depositos_sbs)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.total_activo)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.patrimonio)}
              </td>
              <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                {formatNumberCompact(row.utilidad_neta)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${moraColor(row.mora_pct)}`}>
                {formatPct(row.mora_pct)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${coberturaColor(row.cobertura_pct)}`}>
                {formatPct(row.cobertura_pct)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${roeColor(row.roe)}`}>
                {formatPct(row.roe)}
              </td>
              <td className={`py-2 px-3 text-right tabular-nums font-medium ${roeColor(row.roa)}`}>
                {formatPct(row.roa)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Colores condicionales
// ============================================================================

function moraColor(v: number | null | undefined): string {
  if (v == null) return "text-slate-500";
  if (v >= 0.1) return "text-red-600";
  if (v >= 0.06) return "text-amber-600";
  return "text-emerald-600";
}

function coberturaColor(v: number | null | undefined): string {
  if (v == null) return "text-slate-500";
  if (v >= 1.5) return "text-emerald-600";
  if (v >= 1.0) return "text-amber-600";
  return "text-red-600";
}

function roeColor(v: number | null | undefined): string {
  if (v == null) return "text-slate-500";
  if (v < 0) return "text-red-600";
  if (v >= 0.1) return "text-emerald-600";
  return "text-slate-700";
}

// ============================================================================
// Resumen del subsistema (totales/promedios)
// ============================================================================

function ResumenSF({ rows }: { rows: FilaSF[] }) {
  if (rows.length === 0) return null;
  const totalCartera = rows.reduce((s, r) => s + (r.cartera_bruta ?? 0), 0);
  const totalDepositos = rows.reduce((s, r) => s + (r.depositos_total ?? 0), 0);
  const totalCastigos = rows.reduce((s, r) => s + (r.castigos_12m ?? 0), 0);
  const moraVals = rows.map((r) => r.mora_pct).filter((v): v is number => v != null);
  const roeVals = rows.map((r) => r.roe_pct).filter((v): v is number => v != null);
  const promMora = moraVals.length ? moraVals.reduce((s, v) => s + v, 0) / moraVals.length : null;
  const promRoe = roeVals.length ? roeVals.reduce((s, v) => s + v, 0) / roeVals.length : null;

  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-500 mt-2 mb-1">
      <span>
        <span className="font-medium text-slate-700">{rows.length}</span> entidades
      </span>
      <span>
        Cartera total:{" "}
        <span className="font-medium text-slate-700">{formatNumberCompact(totalCartera)}</span>
      </span>
      <span>
        Depósitos:{" "}
        <span className="font-medium text-slate-700">{formatNumberCompact(totalDepositos)}</span>
      </span>
      <span>
        Castigos 12m:{" "}
        <span className="font-medium text-slate-700">{formatNumberCompact(totalCastigos)}</span>
      </span>
      <span>
        Mora prom:{" "}
        <span className={`font-medium ${moraColor(promMora)}`}>{formatPct(promMora)}</span>
      </span>
      <span>
        ROE prom:{" "}
        <span className={`font-medium ${roeColor(promRoe)}`}>{formatPct(promRoe)}</span>
      </span>
    </div>
  );
}

function ResumenCOOPAC({ rows }: { rows: FilaCOOPAC[] }) {
  if (rows.length === 0) return null;
  const totalCartera = rows.reduce((s, r) => s + (r.cartera_bruta ?? 0), 0);
  const totalActivo = rows.reduce((s, r) => s + (r.total_activo ?? 0), 0);
  const totalPatrimonio = rows.reduce((s, r) => s + (r.patrimonio ?? 0), 0);
  const moraVals = rows.map((r) => r.mora_pct).filter((v): v is number => v != null);
  const roeVals = rows.map((r) => r.roe).filter((v): v is number => v != null);
  const promMora = moraVals.length ? moraVals.reduce((s, v) => s + v, 0) / moraVals.length : null;
  const promRoe = roeVals.length ? roeVals.reduce((s, v) => s + v, 0) / roeVals.length : null;

  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-500 mt-2 mb-1">
      <span>
        <span className="font-medium text-slate-700">{rows.length}</span> cooperativas
      </span>
      <span>
        Cartera total:{" "}
        <span className="font-medium text-slate-700">{formatNumberCompact(totalCartera)}</span>
      </span>
      <span>
        Activo total:{" "}
        <span className="font-medium text-slate-700">{formatNumberCompact(totalActivo)}</span>
      </span>
      <span>
        Patrimonio:{" "}
        <span className="font-medium text-slate-700">{formatNumberCompact(totalPatrimonio)}</span>
      </span>
      <span>
        Mora prom:{" "}
        <span className={`font-medium ${moraColor(promMora)}`}>{formatPct(promMora)}</span>
      </span>
      <span>
        ROE prom:{" "}
        <span className={`font-medium ${roeColor(promRoe)}`}>{formatPct(promRoe)}</span>
      </span>
    </div>
  );
}

// ============================================================================
// Componente principal
// ============================================================================

const SF_ORDER: SubsistemasSF[] = ["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"];
const COOPAC_ORDER: NivelCOOPAC[] = ["COOPAC_N1", "COOPAC_N2A", "COOPAC_N2B", "COOPAC_N3"];

export function EstadisticasRapidasClient({
  sf,
  coopac,
  periodoActual,
  periodoLabel,
  periodos,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"sf" | "coopac">("sf");

  function handlePeriodoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/dashboard/estadisticas-rapidas?periodo=${e.target.value}` as never);
  }

  // Agrupar SF por subsistema
  const sfPorSubsistema = useMemo(() => {
    const map = new Map<SubsistemasSF, FilaSF[]>();
    for (const tipo of SF_ORDER) map.set(tipo, []);
    for (const row of sf) {
      map.get(row.tipo_entidad)?.push(row);
    }
    return map;
  }, [sf]);

  // Agrupar COOPAC por nivel
  const coopacPorNivel = useMemo(() => {
    const map = new Map<NivelCOOPAC, FilaCOOPAC[]>();
    for (const nivel of COOPAC_ORDER) map.set(nivel, []);
    for (const row of coopac) {
      map.get(row.tipo_entidad)?.push(row);
    }
    return map;
  }, [coopac]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Estadísticas Rápidas</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Indicadores clave por entidad y subsistema — Cierre {periodoLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500 font-medium">Periodo</label>
          <select
            value={periodoActual}
            onChange={handlePeriodoChange}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {periodos.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        <button
          onClick={() => setTab("sf")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === "sf"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Sistema Financiero
        </button>
        <button
          onClick={() => setTab("coopac")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === "coopac"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          COOPAC
        </button>
      </div>

      {/* Sistema Financiero */}
      {tab === "sf" && (
        <div className="space-y-10">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
            Mora, Cobertura, ROE y ROA corresponden a los indicadores oficiales publicados por SBS (anualizados). Cartera, Depósitos y Castigos provienen de los EEFF de la SBS.
          </div>
          {SF_ORDER.map((tipo) => {
            const rows = sfPorSubsistema.get(tipo) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={tipo}>
                <div className="flex items-baseline gap-3 mb-1">
                  <h2 className="text-base font-semibold text-slate-800">
                    {tipoEntidadLabel(tipo)}
                  </h2>
                  <span className="text-xs text-slate-400">
                    {rows.length} entidades
                  </span>
                </div>
                <ResumenSF rows={rows} />
                <div className="mt-3">
                  <TablaSF rows={rows} />
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* COOPAC */}
      {tab === "coopac" && (
        <div className="space-y-10">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-700">
            Ratios calculados desde EEFF publicados por SBS. ROE y ROA son acumulados YTD (para diciembre = 12 meses completos). Obligaciones con socios incluye depósitos a plazo y ahorros.
          </div>
          {COOPAC_ORDER.map((nivel) => {
            const rows = coopacPorNivel.get(nivel) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={nivel}>
                <div className="flex items-baseline gap-3 mb-1">
                  <h2 className="text-base font-semibold text-slate-800">
                    Cooperativas {LABEL_NIVEL[nivel]}
                  </h2>
                  <span className="text-xs text-slate-400">
                    {rows.length} cooperativas
                  </span>
                </div>
                <ResumenCOOPAC rows={rows} />
                <div className="mt-3">
                  <TablaCOOPAC rows={rows} />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
