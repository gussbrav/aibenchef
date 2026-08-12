import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { Container, Section } from "@/components/ui";
import { DemoHeader } from "../_shared/demo-header";
import { DemoCTA } from "../_shared/demo-cta";

export const metadata: Metadata = {
  title: "Demo — Informe Ejecutivo · Aibenchef",
  description:
    "Vista pública del Informe Ejecutivo de Aibenchef con data real SBS de la Banca Múltiple peruana al cierre Jun 2026.",
};

// =============================================================================
// Data hardcoded — publica SBS Jun 2026 (aproximada, fines demostrativos)
// =============================================================================
const entidades = ["BCP", "BBVA", "Interbank", "Scotiabank", "Pichincha"] as const;
const ENTIDAD_PROPIA = 0;

type Fila = {
  label: string;
  info?: string;
  valores: number[];
  format: "moneda_mm" | "pct" | "numero" | "moneda_miles";
  signo: 1 | -1 | 0;
};

type Seccion = { titulo: string; filas: Fila[] };

const secciones: Seccion[] = [
  {
    titulo: "Datos generales",
    filas: [
      { label: "N° de agencias", valores: [313, 336, 199, 219, 74], format: "numero", signo: 0 },
      { label: "N° de Clientes de Crédito (Miles)", valores: [4322, 1998, 1043, 1210, 265], format: "numero", signo: 0 },
      { label: "N° de personal", valores: [29243, 15112, 7488, 8112, 1980], format: "numero", signo: 0 },
      { label: "% Part. Colocaciones en SF", info: "Colocaciones / Sistema Financiero total", valores: [31.15, 21.08, 13.02, 14.17, 2.96], format: "pct", signo: 0 },
      { label: "% Part. Depósitos en SF", valores: [33.40, 22.83, 12.09, 13.55, 2.91], format: "pct", signo: 0 },
    ],
  },
  {
    titulo: "Cartera",
    filas: [
      { label: "Cartera Bruta (MM S/)", valores: [132228, 89451, 55240, 60128, 12580], format: "moneda_mm", signo: 0 },
      { label: "Crec. Cartera YoY (%)", valores: [10.93, 8.42, 6.17, 5.88, 12.15], format: "pct", signo: 1 },
      { label: "Cartera MYPE / Total (%)", valores: [18.03, 15.44, 12.20, 13.85, 27.31], format: "pct", signo: 0 },
      { label: "Crédito Prom. por Cliente (Miles S/)", valores: [30.6, 44.8, 53.0, 49.7, 47.5], format: "moneda_miles", signo: 0 },
      { label: "% Créditos Atrasados", info: "Cartera Atrasada / Cartera Bruta (criterio SBS oficial)", valores: [2.73, 3.51, 4.21, 4.02, 4.87], format: "pct", signo: -1 },
      { label: "% Mora Global (sin V/C)", info: "(Atrasada + Refinanciada + Castigos 12m) / Cartera Bruta", valores: [5.55, 6.42, 7.83, 7.11, 9.43], format: "pct", signo: -1 },
      { label: "% Mora Global (con V/C)", info: "Incluye venta de cartera 12m estimada", valores: [8.94, 10.11, 12.44, 11.28, 14.72], format: "pct", signo: -1 },
      { label: "Cobertura CAR (%)", info: "Provisiones / Cartera de Alto Riesgo", valores: [127.94, 118.44, 108.22, 112.51, 101.09], format: "pct", signo: 1 },
    ],
  },
  {
    titulo: "Eficiencia y productividad",
    filas: [
      { label: "Gastos Oper. / Margen Bruto (%)", valores: [38.70, 42.51, 51.20, 47.90, 63.71], format: "pct", signo: -1 },
      { label: "% INOF Neto / Ingresos Totales", valores: [15.90, 12.44, 9.10, 10.55, 4.72], format: "pct", signo: 1 },
      { label: "Cartera x Agencia (Miles S/)", valores: [422454, 266220, 277582, 274558, 169973], format: "numero", signo: 0 },
      { label: "Cartera x Empleado (Miles S/)", valores: [13281, 5919, 7377, 7412, 6353], format: "numero", signo: 1 },
      { label: "N° Clientes x Empleado", valores: [434, 132, 139, 149, 134], format: "numero", signo: 1 },
    ],
  },
  {
    titulo: "Rentabilidad",
    filas: [
      { label: "Utilidad Neta (MM S/)", valores: [7008, 3245, 1782, 1911, 72], format: "moneda_mm", signo: 1 },
      { label: "% ROE", info: "Utilidad TTM / Patrimonio promedio 12M", valores: [27.18, 22.44, 18.90, 20.15, 15.79], format: "pct", signo: 1 },
      { label: "% ROA", info: "Utilidad TTM / Activos promedio 12M", valores: [3.44, 2.81, 2.11, 2.35, 2.50], format: "pct", signo: 1 },
      { label: "Apalancamiento (Activos/Patrimonio)", valores: [7.90, 7.98, 8.95, 8.57, 6.32], format: "numero", signo: 0 },
    ],
  },
];

// =============================================================================
// Helpers heatmap
// =============================================================================
function computeTiers(valores: number[], signo: 1 | -1 | 0): Array<"top" | "high" | "mid" | "low" | "bottom" | null> {
  if (signo === 0) return valores.map(() => null); // sin heatmap
  const idx = valores.map((v, i) => ({ v, i })).sort((a, b) => (signo === 1 ? b.v - a.v : a.v - b.v));
  const tiers: Array<"top" | "high" | "mid" | "low" | "bottom" | null> = new Array(valores.length).fill("mid");
  idx.forEach((x, rank) => {
    if (rank === 0) tiers[x.i] = "top";
    else if (rank === 1) tiers[x.i] = "high";
    else if (rank === idx.length - 1) tiers[x.i] = "bottom";
    else if (rank === idx.length - 2) tiers[x.i] = "low";
  });
  return tiers;
}

const tierStyle: Record<string, string> = {
  top: "bg-emerald-50 text-emerald-900",
  high: "bg-emerald-50/60 text-emerald-800",
  mid: "bg-white text-slate-700",
  low: "bg-amber-50/60 text-amber-800",
  bottom: "bg-rose-50 text-rose-900",
};

function formatValor(v: number, format: Fila["format"]): string {
  if (format === "pct") return `${v.toFixed(2)}%`;
  if (format === "moneda_mm") return v.toLocaleString("es-PE", { maximumFractionDigits: 0 });
  if (format === "moneda_miles") return v.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (format === "numero") {
    if (Math.abs(v) < 100) return v.toFixed(2);
    return v.toLocaleString("es-PE", { maximumFractionDigits: 0 });
  }
  return String(v);
}

// =============================================================================
// Page
// =============================================================================
export default function DemoInformePage() {
  return (
    <>
      <DemoHeader
        icon={BarChart3}
        tag="Informe · Benchmark ejecutivo"
        titulo="Cuadro resumen de la Banca Múltiple peruana"
        descripcion="Compara BCP contra sus 4 principales competidores en 21 métricas clave: cartera, calidad crediticia, eficiencia operativa y rentabilidad. Heatmap por métrica: verde = mejor 25%, rojo = peor 25%."
        chips={[
          { label: "Cierre", value: "Jun 2026", fijo: true },
          { label: "Entidad propia", value: "BCP", fijo: true },
          { label: "Peer group", value: "BBVA · Interbank · Scotiabank · Pichincha", fijo: true },
          { label: "Fuente", value: "SBS Perú" },
        ]}
      />

      <Section>
        <Container size="xl">
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-brand-900 text-white flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
                  Informe Ejecutivo · Cierre Jun 2026
                </p>
                <p className="text-lg font-bold mt-0.5">Banco de Crédito del Perú</p>
              </div>
              <div className="text-xs text-slate-300">
                {secciones.reduce((s, sec) => s + sec.filas.length, 0)} métricas · {entidades.length} entidades
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold min-w-[280px]">
                      Métrica
                    </th>
                    {entidades.map((e, i) => (
                      <th
                        key={e}
                        className={`text-right px-4 py-2.5 text-[13px] font-semibold ${
                          i === ENTIDAD_PROPIA ? "text-brand-900 bg-brand-50" : "text-slate-700"
                        }`}
                      >
                        {e}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {secciones.map((sec) => (
                    <>
                      <tr key={`sec-${sec.titulo}`}>
                        <td
                          colSpan={entidades.length + 1}
                          className="px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 font-bold bg-slate-50 border-t border-b border-slate-200"
                        >
                          {sec.titulo}
                        </td>
                      </tr>
                      {sec.filas.map((f) => {
                        const tiers = computeTiers(f.valores, f.signo);
                        return (
                          <tr key={f.label} className="border-t border-slate-100 hover:bg-slate-50/50">
                            <td className="px-4 py-2 text-[13px] text-slate-700">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 mr-2 align-middle" />
                              {f.label}
                              {f.info && (
                                <span className="ml-1.5 text-[10px] text-slate-400" title={f.info}>ⓘ</span>
                              )}
                            </td>
                            {f.valores.map((v, i) => {
                              const esPropio = i === ENTIDAD_PROPIA;
                              const cellStyle = esPropio
                                ? "bg-brand-50 text-brand-900 font-semibold"
                                : tiers[i]
                                ? tierStyle[tiers[i]!]
                                : "bg-white text-slate-700";
                              return (
                                <td key={i} className={`px-4 py-2 text-right tabular-nums text-[13px] ${cellStyle}`}>
                                  {formatValor(v, f.format)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-500">
              <span>
                Fuente: Superintendencia de Banca, Seguros y AFP (SBS Perú) · Data pública procesada por Aibenchef
              </span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-100" /> Mejor 25%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-white ring-1 ring-slate-200" /> Cerca mediana
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-100" /> Peor 25%
                </span>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <DemoCTA
        titulo="Genera este cuadro para TU peer group en 30 segundos"
        features={[
          "Elige cualquier entidad SBS como tu 'entidad propia'",
          "Configura peer group ilimitado (2-10 entidades)",
          "Cambia el cierre a cualquier mes desde 2010",
          "Filtra por consolidado o solo doméstico",
          "Exporta a PDF listo para directorio",
          "Publicaciones AI con gráficos incluidas",
        ]}
      />
    </>
  );
}
