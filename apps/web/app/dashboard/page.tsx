import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, Building2, Calendar } from "lucide-react";
import { Card } from "@/components/ui";
import { getRatiosLatest } from "@/lib/domains/analytics";
import {
  formatPct,
  formatNumberCompact,
  tipoEntidadLabel,
  TIPO_ENTIDAD_ORDER,
} from "./_lib/format";

export const metadata: Metadata = {
  title: "Resumen",
};

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const rows = await getRatiosLatest({ moneda: "TOTAL" });
  const lastPeriod = rows[0]?.periodo;
  const lastFecha = rows[0]?.fechaCierre;

  const totalEntidades = rows.length;
  const microfin = rows.filter((r) => r.microfinanciera === "SI").length;

  const avgRoa = avg(rows.map((r) => r.roa));
  const avgRoe = avg(rows.map((r) => r.roe));
  const avgMora = avg(rows.map((r) => r.ratioMora));

  // Ordenar: 1) grupo en orden canonico SBS, 2) cartera bruta DESC dentro del grupo
  const sortedRows = [...rows].sort((a, b) => {
    const ga = TIPO_ENTIDAD_ORDER[a.tipoEntidad] ?? 99;
    const gb = TIPO_ENTIDAD_ORDER[b.tipoEntidad] ?? 99;
    if (ga !== gb) return ga - gb;
    const ca = a.carteraBruta ?? -Infinity;
    const cb = b.carteraBruta ?? -Infinity;
    return cb - ca;
  });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Resumen del sistema</h1>
        <p className="text-slate-600 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          {lastFecha ? `Última publicación SBS: ${formatPeriod(lastPeriod)} (cierre ${lastFecha})` : "Sin datos aún"}
        </p>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Building2}
          label="Entidades reportadas"
          value={totalEntidades.toString()}
          sub={`${microfin} microfinancieras`}
        />
        <KpiCard
          icon={BarChart3}
          label="ROA promedio"
          value={formatPct(avgRoa)}
          sub="Rentabilidad sobre activos"
        />
        <KpiCard
          icon={BarChart3}
          label="ROE promedio"
          value={formatPct(avgRoe)}
          sub="Rentabilidad sobre patrimonio"
        />
        <KpiCard
          icon={BarChart3}
          label="Mora promedio"
          value={formatPct(avgMora)}
          sub="Cartera atrasada / bruta"
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900">Entidades — último cierre</h2>
          <Link
            href="/dashboard/eeff"
            className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline font-medium"
          >
            Ver detalle por entidad
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <Card variant="elevated" className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-6 py-3 font-semibold">Entidad</th>
                  <th className="text-left px-4 py-3 font-semibold">Grupo</th>
                  <th className="text-right px-4 py-3 font-semibold">Activo</th>
                  <th className="text-right px-4 py-3 font-semibold">Cartera bruta</th>
                  <th className="text-right px-4 py-3 font-semibold">Mora</th>
                  <th className="text-right px-4 py-3 font-semibold">ROA</th>
                  <th className="text-right px-4 py-3 font-semibold">ROE</th>
                  <th className="text-right px-6 py-3 font-semibold">Eficiencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((r) => (
                  <tr key={`${r.nombCorreg}-${r.moneda}`} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-900">{r.nombCorreg}</td>
                    <td className="px-4 py-3 text-slate-600">{tipoEntidadLabel(r.tipoEntidad)}</td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                      {formatNumberCompact(r.totalActivo)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                      {formatNumberCompact(r.carteraBruta)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <RatioBadge value={r.ratioMora} thresholdGood={0.05} thresholdBad={0.1} inverted />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <RatioBadge value={r.roa} thresholdGood={0.01} thresholdBad={0} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <RatioBadge value={r.roe} thresholdGood={0.08} thresholdBad={0} />
                    </td>
                    <td className="px-6 py-3 text-right text-slate-700 tabular-nums">
                      {formatPct(r.ratioEficiencia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function formatPeriod(p: number | undefined): string {
  if (!p) return "";
  const year = Math.floor(p / 100);
  const month = p % 100;
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${meses[month - 1]} ${year}`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card variant="elevated" className="p-6">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{label}</p>
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <p className="text-3xl font-bold text-slate-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </Card>
  );
}

function RatioBadge({
  value,
  thresholdGood,
  thresholdBad,
  inverted = false,
}: {
  value: number | null;
  thresholdGood: number;
  thresholdBad: number;
  inverted?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-slate-400">—</span>;
  }
  let color = "text-slate-700";
  if (inverted) {
    if (value < thresholdGood) color = "text-emerald-600 font-medium";
    else if (value > thresholdBad) color = "text-rose-600 font-medium";
  } else {
    if (value >= thresholdGood) color = "text-emerald-600 font-medium";
    else if (value <= thresholdBad) color = "text-rose-600 font-medium";
  }
  return <span className={color}>{formatPct(value)}</span>;
}
