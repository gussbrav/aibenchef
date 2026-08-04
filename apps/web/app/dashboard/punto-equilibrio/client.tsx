"use client";

/**
 * PuntoEquilibrioClient — vista dual del PE:
 *   Tab 1 (Historico mi entidad): tabla con cierres anuales + ultimos meses
 *     para mi entidad. Formato del "cuadro del gerente".
 *   Tab 2 (Comparativo peers): tabla de N entidades side-by-side en el
 *     ultimo periodo. Highlight de la entidad propia.
 */

import { useState } from "react";
import { BarChart3, Building2, Info, TrendingUp, Users } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { Cliente } from "@/lib/domains/informe/types";
import type {
  PuntoEquilibrioRow,
  PuntoEquilibrioComparativoRow,
} from "@/lib/domains/punto-equilibrio";

type Props = {
  cliente: Cliente;
  periodo: { codigo: number; label: string };
  historico: PuntoEquilibrioRow[];
  comparativo: PuntoEquilibrioComparativoRow[];
  desdeAnio: number;
};

type Tab = "historico" | "comparativo";

export function PuntoEquilibrioClient({
  cliente,
  periodo,
  historico,
  comparativo,
}: Props) {
  const [tab, setTab] = useState<Tab>("historico");

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto px-2">
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
            <h1 className="text-2xl md:text-3xl font-bold mb-1">
              Punto de Equilibrio
            </h1>
            <p className="text-sm opacity-90">
              {cliente.nombre} · Cierre {periodo.label}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/15 rounded text-xs">
              <Building2 className="w-3.5 h-3.5" />
              {cliente.entidadPropia}
            </div>
          </div>
        </div>
      </header>

      {/* Info banner que explica el PE */}
      <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-sky-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-sky-900">
          <p className="font-semibold mb-1">Qué es el Punto de Equilibrio</p>
          <p className="text-sky-800 leading-relaxed">
            Es el rendimiento mínimo sobre cartera que necesitas para cubrir
            todos tus costos (fondeo + provisiones + gastos operacionales),
            expresado en % de la cartera promedio de 12 meses. Si tu
            rendimiento real supera el PE, generas margen; si no, hay pérdida.
          </p>
        </div>
      </div>

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
            label={`Comparativo con peers (${comparativo.length})`}
          />
        </div>
      </div>

      {tab === "historico" && (
        <HistoricoTable data={historico} entidad={cliente.entidadPropia} />
      )}
      {tab === "comparativo" && (
        <ComparativoTable data={comparativo} periodoLabel={periodo.label} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BarChart3;
  label: string;
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
 * Tabla histórica formato "cuadro del gerente":
 *   Rows: (+) Rendimiento, (+) Otros, (-) GF, (-) CP, (-) GO, MAI, PE
 *   Cols: Periodos (cierres Dic + mismo mes año prev + actual)
 */
function HistoricoTable({ data, entidad }: { data: PuntoEquilibrioRow[]; entidad: string }) {
  if (data.length === 0) {
    return <EmptyState />;
  }
  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <h2 className="text-sm font-semibold text-slate-900">
          Cuadro histórico — {entidad}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Valores anualizados TTM sobre cartera promedio de 12 meses.
          Cierres de Diciembre + mes actual + mismo mes año previo.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700 min-w-[220px]">
                Componente
              </th>
              {data.map((p) => (
                <th
                  key={p.periodo}
                  className={cn(
                    "text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider min-w-[100px]",
                    esMesActualEspecial(p, data)
                      ? "bg-brand-50 text-brand-800"
                      : "text-slate-700",
                  )}
                >
                  <div className="whitespace-nowrap">Al cierre</div>
                  <div className="whitespace-nowrap">{p.periodoLabel}</div>
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

/**
 * Detecta si un periodo es "mes actual" o "mismo mes año previo" (no Diciembre)
 * para highlightear la columna. Los cierres Dic van con estilo neutro.
 */
function esMesActualEspecial(p: PuntoEquilibrioRow, all: PuntoEquilibrioRow[]): boolean {
  const mes = p.periodo % 100;
  if (mes === 12) return false;
  const ultimo = all[all.length - 1];
  if (!ultimo) return false;
  const ultimoMes = ultimo.periodo % 100;
  return mes === ultimoMes;
}

function Row({
  label,
  prefix,
  data,
  field,
  positive,
  negative,
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
      <td className="px-4 py-2 text-slate-700">
        <span className="text-slate-400 font-mono mr-1">{prefix}</span>
        {label}
      </td>
      {data.map((p) => {
        const v = p[field] as number | null;
        const display = fmtPct(v, { withSign: negative });
        return (
          <td
            key={p.periodo}
            className={cn(
              "text-right px-4 py-2 font-mono tabular-nums",
              positive && v != null && "text-emerald-700",
              negative && v != null && "text-rose-700",
              v == null && "text-slate-400 italic",
            )}
          >
            {display}
          </td>
        );
      })}
    </tr>
  );
}

function RowBold({
  label,
  data,
  field,
}: {
  label: string;
  data: PuntoEquilibrioRow[];
  field: keyof PuntoEquilibrioRow;
}) {
  return (
    <tr className="border-t border-slate-200 bg-slate-50">
      <td className="px-4 py-2.5 font-semibold text-slate-900">{label}</td>
      {data.map((p) => {
        const v = p[field] as number | null;
        return (
          <td
            key={p.periodo}
            className="text-right px-4 py-2.5 font-mono tabular-nums font-semibold text-slate-900"
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function RowHighlight({
  label,
  data,
  field,
}: {
  label: string;
  data: PuntoEquilibrioRow[];
  field: keyof PuntoEquilibrioRow;
}) {
  return (
    <tr className="border-t-2 border-slate-800 bg-brand-50">
      <td className="px-4 py-3 font-bold text-slate-900 uppercase text-xs tracking-wider">
        {label}
      </td>
      {data.map((p) => {
        const v = p[field] as number | null;
        return (
          <td
            key={p.periodo}
            className="text-right px-4 py-3 font-mono tabular-nums font-bold text-slate-900"
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function SeparatorRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="h-px bg-slate-200 p-0" />
    </tr>
  );
}

/**
 * Tabla comparativa: N entidades como columnas, componentes como filas.
 * Formato clásico para leer "quién está mejor parado hoy".
 */
function ComparativoTable({
  data,
  periodoLabel,
}: {
  data: PuntoEquilibrioComparativoRow[];
  periodoLabel: string;
}) {
  if (data.length === 0) {
    return <EmptyState />;
  }
  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <h2 className="text-sm font-semibold text-slate-900">
          Comparativo con peers — Cierre {periodoLabel}
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Punto de Equilibrio de cada entidad al mismo periodo. Tu entidad
          resaltada en color.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700 min-w-[220px]">
                Componente
              </th>
              {data.map((e) => (
                <th
                  key={e.entidad}
                  className={cn(
                    "text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider min-w-[120px]",
                    e.esPropio ? "bg-brand-100 text-brand-900" : "text-slate-700",
                  )}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: e.color }}
                    />
                    <span className="whitespace-nowrap">{e.entidad}</span>
                  </div>
                  {e.esPropio && (
                    <div className="text-[9px] text-brand-700 font-bold mt-0.5">
                      TU ENTIDAD
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompRow label="Rendimiento de cartera" prefix="(+)" data={data} field="pctRendimiento" positive />
            <CompRow label="Otros Ingresos (Egresos)" prefix="(+)" data={data} field="pctOtros" positive />
            <CompRow label="Gasto Financiero" prefix="(-)" data={data} field="pctCostoFondeo" negative />
            <CompRow label="Costo de Provisión" prefix="(-)" data={data} field="pctProvisiones" negative />
            <CompRow label="Gastos Operacionales" prefix="(-)" data={data} field="pctGastosOp" negative />
            <SeparatorRow cols={data.length + 1} />
            <CompRowBold label="Margen antes de Impuestos" data={data} field="pctMargenNeto" />
            <CompRowHighlight label="Punto de Equilibrio" data={data} field="pctPuntoEq" />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompRow({
  label,
  prefix,
  data,
  field,
  positive,
  negative,
}: {
  label: string;
  prefix: "(+)" | "(-)";
  data: PuntoEquilibrioComparativoRow[];
  field: keyof PuntoEquilibrioComparativoRow;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-4 py-2 text-slate-700">
        <span className="text-slate-400 font-mono mr-1">{prefix}</span>
        {label}
      </td>
      {data.map((e) => {
        const v = e[field] as number | null;
        return (
          <td
            key={e.entidad}
            className={cn(
              "text-right px-4 py-2 font-mono tabular-nums",
              positive && v != null && "text-emerald-700",
              negative && v != null && "text-rose-700",
              v == null && "text-slate-400 italic",
              e.esPropio && "bg-brand-50/30",
            )}
          >
            {fmtPct(v, { withSign: negative })}
          </td>
        );
      })}
    </tr>
  );
}

function CompRowBold({
  label,
  data,
  field,
}: {
  label: string;
  data: PuntoEquilibrioComparativoRow[];
  field: keyof PuntoEquilibrioComparativoRow;
}) {
  return (
    <tr className="border-t border-slate-200 bg-slate-50">
      <td className="px-4 py-2.5 font-semibold text-slate-900">{label}</td>
      {data.map((e) => {
        const v = e[field] as number | null;
        return (
          <td
            key={e.entidad}
            className={cn(
              "text-right px-4 py-2.5 font-mono tabular-nums font-semibold text-slate-900",
              e.esPropio && "bg-brand-100/50",
            )}
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function CompRowHighlight({
  label,
  data,
  field,
}: {
  label: string;
  data: PuntoEquilibrioComparativoRow[];
  field: keyof PuntoEquilibrioComparativoRow;
}) {
  return (
    <tr className="border-t-2 border-slate-800 bg-brand-50">
      <td className="px-4 py-3 font-bold text-slate-900 uppercase text-xs tracking-wider">
        {label}
      </td>
      {data.map((e) => {
        const v = e[field] as number | null;
        return (
          <td
            key={e.entidad}
            className={cn(
              "text-right px-4 py-3 font-mono tabular-nums font-bold text-slate-900",
              e.esPropio && "bg-brand-200/70 ring-2 ring-brand-500 ring-inset",
            )}
          >
            {fmtPct(v)}
          </td>
        );
      })}
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
      <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-600">
        Sin datos disponibles para este periodo.
      </p>
    </div>
  );
}

/**
 * Formato de porcentaje: 22.9%.
 * withSign: fuerza signo (para columnas negativas mostramos '-5.3%').
 * null → "—" tenue.
 */
function fmtPct(v: number | null, opts?: { withSign?: boolean }): string {
  if (v == null) return "—";
  // El view guarda valores en formato decimal (0.229) o porcentaje (22.9)?
  // Los KPIs pe_* del compute_punto_equilibrio.sql estan en formato porcentaje
  // (multiplicados por 100 dentro de la function). Se muestran tal cual con %.
  const n = Number(v);
  if (opts?.withSign) {
    const abs = Math.abs(n);
    return `-${abs.toFixed(2)}%`;
  }
  return `${n.toFixed(2)}%`;
}
