import type { Metadata } from "next";
import { TrendingUp } from "lucide-react";

import { Container, Section } from "@/components/ui";
import { DemoHeader } from "../_shared/demo-header";
import { DemoCTA } from "../_shared/demo-cta";

export const metadata: Metadata = {
  title: "Demo — Punto de Equilibrio · Aibenchef",
  description:
    "Vista pública del análisis de Punto de Equilibrio de BCP y sus principales competidores en la Banca Múltiple peruana.",
};

// =============================================================================
// Data hardcoded — Punto de Equilibrio anual BCP + 2 peers · Dic 21 -> Jun 26
// =============================================================================
const cierres = ["Dic-21", "Dic-22", "Dic-23", "Dic-24", "Dic-25", "Jun-26"];

const series = [
  {
    entidad: "BCP",
    color: "#0F2A5E",
    destacada: true,
    puntos: [9.63, 7.25, 9.30, 9.83, 9.60, 9.63],
    rendimiento: [12.85, 10.20, 11.45, 12.55, 12.90, 13.10],
    otros: [3.87, 4.77, 5.49, 6.30, 6.54, 6.84],
    fondeo: [-2.10, -1.85, -3.20, -3.80, -3.65, -3.60],
    provisiones: [-1.85, -2.15, -2.35, -2.20, -2.15, -2.10],
    gastosOp: [-5.68, -3.25, -3.75, -3.83, -3.80, -3.93],
  },
  {
    entidad: "BBVA",
    color: "#8B5CF6",
    destacada: false,
    puntos: [9.90, 7.95, 9.50, 10.20, 9.85, 9.75],
    rendimiento: [11.55, 9.45, 10.60, 11.85, 12.15, 12.30],
    otros: [3.15, 3.98, 4.65, 5.20, 5.45, 5.60],
    fondeo: [-1.95, -1.55, -2.80, -3.45, -3.30, -3.25],
    provisiones: [-2.10, -2.45, -2.55, -2.35, -2.25, -2.30],
    gastosOp: [-5.85, -3.95, -4.15, -4.40, -4.30, -4.20],
  },
  {
    entidad: "Interbank",
    color: "#F59E0B",
    destacada: false,
    puntos: [11.20, 8.85, 10.25, 11.10, 10.60, 10.45],
    rendimiento: [13.25, 10.85, 11.90, 12.85, 12.75, 12.55],
    otros: [4.10, 5.05, 5.65, 6.10, 6.15, 6.30],
    fondeo: [-2.55, -2.10, -3.50, -4.15, -3.90, -3.85],
    provisiones: [-2.75, -2.85, -2.90, -2.70, -2.65, -2.60],
    gastosOp: [-5.90, -3.90, -3.85, -4.25, -4.05, -4.00],
  },
];

const minY = 6.5;
const maxY = 12;
const W = 900;
const H = 320;
const padLeft = 50;
const padRight = 120;
const padTop = 20;
const padBottom = 40;

function scaleX(i: number): number {
  return padLeft + (i / (cierres.length - 1)) * (W - padLeft - padRight);
}
function scaleY(v: number): number {
  return H - padBottom - ((v - minY) / (maxY - minY)) * (H - padTop - padBottom);
}

// =============================================================================
// Page
// =============================================================================
export default function DemoPuntoEquilibrioPage() {
  const ticksY = [7, 8, 9, 10, 11, 12];

  return (
    <>
      <DemoHeader
        icon={TrendingUp}
        tag="Punto de Equilibrio · Rendimiento mínimo"
        titulo="Evolución del Punto de Equilibrio · BCP y peers"
        descripcion="El % de rendimiento sobre cartera que necesitas para cubrir todos los costos (fondeo + provisiones + gastos operacionales). Si el rendimiento real supera al PE, generas margen; si no, hay pérdida."
        chips={[
          { label: "Cierre", value: "Jun 2026", fijo: true },
          { label: "Entidad propia", value: "BCP", fijo: true },
          { label: "Peer group", value: "BBVA · Interbank", fijo: true },
          { label: "Granularidad", value: "Anual (5 cierres)", fijo: true },
        ]}
      />

      <Section>
        <Container size="xl">
          {/* Line chart */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">Punto de Equilibrio · Serie anual</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Otros egresos + Costo de fondeo + Provisiones + Gastos operativos, todo sobre cartera promedio
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {series.map((s) => (
                  <span key={s.entidad} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-4 h-0.5 rounded-full"
                      style={{ backgroundColor: s.color, height: s.destacada ? "3px" : "2px" }}
                    />
                    <span className={s.destacada ? "font-bold text-slate-900" : "text-slate-600"}>
                      {s.entidad}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="p-6">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
                {/* Grid horizontal */}
                {ticksY.map((y) => (
                  <g key={y}>
                    <line
                      x1={padLeft}
                      y1={scaleY(y)}
                      x2={W - padRight}
                      y2={scaleY(y)}
                      stroke="#e2e8f0"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={scaleY(y) + 4}
                      fontSize="10"
                      fill="#64748b"
                      textAnchor="end"
                    >
                      {y.toFixed(0)}%
                    </text>
                  </g>
                ))}
                {/* Ejes X labels */}
                {cierres.map((c, i) => (
                  <text
                    key={c}
                    x={scaleX(i)}
                    y={H - padBottom + 18}
                    fontSize="10"
                    fill="#64748b"
                    textAnchor="middle"
                  >
                    {c}
                  </text>
                ))}
                {/* Series */}
                {series.map((s) => {
                  const path = s.puntos
                    .map((v, i) => `${i === 0 ? "M" : "L"}${scaleX(i)},${scaleY(v)}`)
                    .join(" ");
                  const ult = s.puntos[s.puntos.length - 1]!;
                  return (
                    <g key={s.entidad}>
                      <path
                        d={path}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={s.destacada ? 3 : 2}
                        strokeOpacity={s.destacada ? 1 : 0.75}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {s.puntos.map((v, i) => (
                        <circle
                          key={i}
                          cx={scaleX(i)}
                          cy={scaleY(v)}
                          r={s.destacada ? 4 : 3}
                          fill={s.color}
                          stroke="white"
                          strokeWidth="1.5"
                        />
                      ))}
                      {/* Label final derecha */}
                      <text
                        x={scaleX(cierres.length - 1) + 10}
                        y={scaleY(ult) + 4}
                        fontSize={s.destacada ? "12" : "11"}
                        fontWeight={s.destacada ? "700" : "500"}
                        fill={s.color}
                      >
                        {s.entidad} · {ult.toFixed(2)}%
                      </text>
                    </g>
                  );
                })}
              </svg>
              <p className="text-[11px] text-slate-500 italic mt-3 text-center">
                Fuente pública oficial · Cierres anuales Dic-21 a Jun-26
              </p>
            </div>
          </div>

          {/* Tabla comparativa del último cierre */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-base font-bold text-slate-900">Descomposición del cierre · Jun 2026</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Componentes del PE en % sobre cartera promedio 12M
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      Componente
                    </th>
                    {series.map((s) => (
                      <th
                        key={s.entidad}
                        className={`text-right px-4 py-2.5 text-[12px] font-semibold ${
                          s.destacada ? "text-brand-900 bg-brand-50" : "text-slate-700"
                        }`}
                      >
                        {s.entidad}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "rendimiento" as const, label: "Rendimiento de cartera", positivo: true },
                    { key: "otros" as const, label: "Otros egresos", positivo: false },
                    { key: "fondeo" as const, label: "Costo de fondeo", positivo: false },
                    { key: "provisiones" as const, label: "Provisiones", positivo: false },
                    { key: "gastosOp" as const, label: "Gastos operativos", positivo: false },
                  ].map((row) => (
                    <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="px-4 py-2 text-[13px] text-slate-700">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${row.positivo ? "bg-emerald-500" : "bg-rose-400"}`} />
                        {row.label}
                      </td>
                      {series.map((s) => (
                        <td
                          key={s.entidad}
                          className={`px-4 py-2 text-right tabular-nums text-[13px] ${
                            s.destacada ? "bg-brand-50 text-brand-900 font-semibold" : "text-slate-700"
                          }`}
                        >
                          {s[row.key][s[row.key].length - 1]!.toFixed(2)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Total */}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="px-4 py-2.5 text-[13px] text-slate-900">Punto de Equilibrio</td>
                    {series.map((s) => (
                      <td
                        key={s.entidad}
                        className={`px-4 py-2.5 text-right tabular-nums text-[14px] ${
                          s.destacada ? "bg-brand-100 text-brand-900" : "text-slate-900"
                        }`}
                      >
                        {s.puntos[s.puntos.length - 1]!.toFixed(2)}%
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Container>
      </Section>

      <DemoCTA
        titulo="Calcula el PE de tu entidad vs cualquier peer group"
        features={[
          "Serie histórica desde 2009 (mensual, trimestral o anual)",
          "Descomposición por componente en cada cierre",
          "Compara hasta 8 entidades simultáneas",
          "Ordena por columna, drag & drop de peers",
          "Colores personalizables + persistencia",
          "Export PDF con narrativa AI del cierre",
        ]}
      />
    </>
  );
}
