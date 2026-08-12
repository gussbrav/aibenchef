import type { Metadata } from "next";
import { GitBranch, Sparkles } from "lucide-react";

import { Container, Section } from "@/components/ui";
import { DemoHeader } from "../_shared/demo-header";
import { DemoCTA } from "../_shared/demo-cta";

export const metadata: Metadata = {
  title: "Demo — DuPont / Rentabilidad · Aibenchef",
  description:
    "Vista pública del análisis DuPont de las 4 principales microfinancieras peruanas al cierre Jun 2026.",
};

// =============================================================================
// Data hardcoded — DuPont de las 4 principales microfinancieras
// =============================================================================
const entidades = [
  { nombre: "Compartamos", roe: 27.47, roa: 5.93, apal: 4.63, mfb: 24.10, provisiones: -3.50, gastosOp: -12.85, color: "#0F2A5E", destacada: true },
  { nombre: "CMAC Huancayo", roe: 29.89, roa: 3.50, apal: 8.53, mfb: 18.20, provisiones: -3.10, gastosOp: -9.40, color: "#F59E0B", destacada: false },
  { nombre: "Mibanco", roe: 25.27, roa: 3.72, apal: 6.80, mfb: 20.40, provisiones: -3.30, gastosOp: -11.20, color: "#8B5CF6", destacada: false },
  { nombre: "CMAC Arequipa", roe: 20.55, roa: 1.93, apal: 10.67, mfb: 15.80, provisiones: -3.95, gastosOp: -8.85, color: "#10B981", destacada: false },
];

const maxRoe = 32;

// =============================================================================
// Narrativa AI — hardcoded (en la app real la genera Claude)
// =============================================================================
const narrativa = {
  roe: [
    "Compartamos consigue el mayor ROE del grupo (27.47%) gracias a una rentabilidad operativa excepcional (ROA 5.93%, casi 3 veces la de Arequipa), suficiente para compensar un apalancamiento deliberadamente bajo (4.63×).",
    "CMAC Huancayo alcanza 29.89% en Jun-26 amplificando apalancamiento de 8.53 a 10.53 veces y mejorando ROA de 1.34% a 3.50% en 18 meses — trayectoria explosiva.",
    "CMAC Arequipa duplica su ROE a 20.55% principalmente por leverage: con apalancamiento de 10.67 veces amplifica un ROA moderado de 1.93%.",
  ],
  roa: [
    "Compartamos lidera con 5.93% — cada 100 soles de activos gana 5.93 al año. Es 3× más que Arequipa (1.93%) y muestra un motor operativo estructural, no coyuntural.",
    "Huancayo y Mibanco quedan cerca (3.50% y 3.72%) — desempeño sano pero muy dependiente del leverage para llegar a ROE competitivo.",
  ],
  motor: [
    "Dos rutas al ROE alto: Compartamos por eficiencia (ROA alto, leverage bajo — el estructural). Arequipa por leverage (ROA moderado, apalancamiento alto — el frágil).",
    "La lección: el ROE aislado no dice nada. Un ROE de 27% con leverage bajo es señal de fortaleza; el mismo ROE con leverage 10× es riesgo empaquetado.",
  ],
};

// =============================================================================
// Page
// =============================================================================
export default function DemoDupontPage() {
  return (
    <>
      <DemoHeader
        icon={GitBranch}
        tag="DuPont · Rentabilidad descompuesta"
        titulo="ROE de las 4 principales microfinancieras peruanas"
        descripcion="Árbol DuPont completo: ROE = ROA × Apalancamiento. Descompone quién gana por eficiencia operativa vs quién por leverage, con lectura editorial senior generada por AI."
        chips={[
          { label: "Cierre", value: "Jun 2026", fijo: true },
          { label: "Entidad propia", value: "Compartamos", fijo: true },
          { label: "Peer group", value: "CMAC Huancayo · Mibanco · CMAC Arequipa", fijo: true },
        ]}
      />

      <Section>
        <Container size="xl">
          {/* Ranking ROE — bar chart horizontal */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-base font-bold text-slate-900">Ranking ROE — Jun 2026</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Rentabilidad sobre patrimonio · TTM
              </p>
            </div>
            <div className="p-6 space-y-3">
              {[...entidades].sort((a, b) => b.roe - a.roe).map((e) => (
                <div key={e.nombre} className="flex items-center gap-3">
                  <span className={`text-sm w-32 truncate ${e.destacada ? "font-bold text-brand-900" : "text-slate-700"}`}>
                    {e.nombre}
                  </span>
                  <div className="flex-1 h-8 bg-slate-100 rounded-md relative overflow-hidden">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{ width: `${(e.roe / maxRoe) * 100}%`, backgroundColor: e.color }}
                    />
                    <span className="absolute inset-0 flex items-center px-3 text-sm font-bold text-white drop-shadow">
                      {e.roe.toFixed(2)}%
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums w-40 text-right">
                    ROA {e.roa.toFixed(2)}% × Apal {e.apal.toFixed(2)}×
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Lectura AI */}
          <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-white ring-1 ring-brand-200 p-6 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-brand-600" />
              <h3 className="text-sm font-bold text-brand-900 uppercase tracking-wider">
                Lectura AI · ROE
              </h3>
              <span className="text-[10px] text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full font-semibold">
                análisis editorial
              </span>
            </div>
            <ul className="space-y-2.5 text-[13.5px] text-slate-800 leading-relaxed">
              {narrativa.roe.map((linea, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                  <span>{linea}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Descomposicion — tabla */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-base font-bold text-slate-900">Descomposición DuPont</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cada componente sobre activos promedio 12M · % anualizado
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      Componente
                    </th>
                    {entidades.map((e) => (
                      <th
                        key={e.nombre}
                        className={`text-right px-4 py-2.5 text-[12px] font-semibold ${
                          e.destacada ? "text-brand-900 bg-brand-50" : "text-slate-700"
                        }`}
                      >
                        {e.nombre}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "roe" as const, label: "ROE (% patrimonio)", suffix: "%" },
                    { key: "roa" as const, label: "ROA (% activos)", suffix: "%" },
                    { key: "apal" as const, label: "Apalancamiento (activos/patrimonio)", suffix: "×" },
                    { key: "mfb" as const, label: "Margen Financiero Bruto", suffix: "%" },
                    { key: "provisiones" as const, label: "Gasto Provisiones", suffix: "%" },
                    { key: "gastosOp" as const, label: "Gastos Operativos", suffix: "%" },
                  ].map((row) => (
                    <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="px-4 py-2 text-[13px] text-slate-700 font-medium">{row.label}</td>
                      {entidades.map((e) => (
                        <td
                          key={e.nombre}
                          className={`px-4 py-2 text-right tabular-nums text-[13px] ${
                            e.destacada ? "bg-brand-50 text-brand-900 font-semibold" : "text-slate-700"
                          }`}
                        >
                          {e[row.key].toFixed(2)}{row.suffix}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Lectura AI motor operativo */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white ring-1 ring-emerald-200 p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-emerald-900 uppercase tracking-wider">
                Lectura AI · Motor operativo
              </h3>
            </div>
            <ul className="space-y-2.5 text-[13.5px] text-slate-800 leading-relaxed">
              {narrativa.motor.map((linea, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span>{linea}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <DemoCTA
        titulo="Descompone el ROE de tu entidad vs cualquier peer group"
        features={[
          "Árbol DuPont de 4 niveles interactivo",
          "Lectura AI editorial que interpreta la data",
          "Compara 2-6 entidades simultáneas",
          "Serie histórica de ROE por múltiples cierres",
          "Colores personalizables por entidad",
          "Export PDF con la narrativa incluida",
        ]}
      />
    </>
  );
}
