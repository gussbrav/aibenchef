/**
 * Mockup visual del /dashboard/informe (Cuadro Resumen) — usado en el
 * landing publico como preview del producto. Componente React puro con
 * Tailwind: responsive, sin peso de imagen, y actualizable via script.
 *
 * Fuente de data: `dashboard-mockup-data.json` (sibling file). El script
 * `pnpm regen-hero` (ver scripts/regen-hero-mockup.ts) regenera ese JSON
 * queryeando la DB prod despues de cada ingesta mensual — asi el landing
 * siempre muestra el ultimo cierre publicado sin editar codigo.
 *
 * Fail-safe: si el JSON se corrompe o falta un campo, tsc falla en build
 * y el deploy se aborta antes de romper la landing en produccion.
 */

import rawMockupData from "./dashboard-mockup-data.json";

// ============================================================================
// Types (contract fuerte con el JSON)
// ============================================================================

type FormatCelda = "moneda_mm" | "pct" | "moneda_mm_utilidad";
type Seccion = "cartera" | "calidad" | "rentabilidad";
type Signo = 1 | -1;

type FilaJson = {
  label: string;
  seccion: Seccion;
  valores: number[];
  format: FormatCelda;
  signo: Signo;
};

type MockupData = {
  generatedAt: string;
  generatedBy: string;
  periodo: number;
  periodoLabel: string;
  grupoSbs: string;
  propiaIdx: number;
  entidades: readonly string[];
  filas: FilaJson[];
};

// Cast controlado: si el JSON tiene un `format` o `seccion` no valido,
// el runtime lo detectaria; en la practica el script regen escribe solo
// valores validos y el schema esta congelado. Se mantiene el cast para
// evitar validaciones expensive en cada render del landing.
const mockupData = rawMockupData as MockupData;

/**
 * Export util para que otros componentes del landing (hero caption,
 * demo pages metadata) consuman el mismo periodo — asi actualizar el
 * JSON refleja el nuevo cierre en todo el sitio de una.
 */
export const MOCKUP_META = {
  periodo: mockupData.periodo,
  periodoLabel: mockupData.periodoLabel,
  grupoSbs: mockupData.grupoSbs,
  entidadPropia: mockupData.entidades[mockupData.propiaIdx] ?? "",
} as const;

// ============================================================================
// Compute helpers (heatmap por celda)
// ============================================================================

function computeTiers(
  valores: number[],
  signo: Signo,
): Array<"top" | "high" | "mid" | "low" | "bottom"> {
  const idx = valores
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (signo === 1 ? b.v - a.v : a.v - b.v));
  const tiers: Array<"top" | "high" | "mid" | "low" | "bottom"> = new Array(
    valores.length,
  ).fill("mid");
  idx.forEach((x, rank) => {
    if (rank === 0) tiers[x.i] = "top";
    else if (rank <= 1) tiers[x.i] = "high";
    else if (rank >= idx.length - 1) tiers[x.i] = "bottom";
    else if (rank >= idx.length - 2) tiers[x.i] = "low";
  });
  return tiers;
}

const tierStyle: Record<"top" | "high" | "mid" | "low" | "bottom", string> = {
  top: "bg-emerald-50 text-emerald-900",
  high: "bg-emerald-50/60 text-emerald-800",
  mid: "bg-white text-slate-700",
  low: "bg-amber-50/60 text-amber-800",
  bottom: "bg-rose-50 text-rose-900",
};

const seccionLabels: Record<Seccion, string> = {
  cartera: "Cartera",
  calidad: "Calidad de Cartera",
  rentabilidad: "Rentabilidad",
};

function formatValor(v: number, format: FormatCelda): string {
  if (format === "pct") return `${v.toFixed(2)}%`;
  // moneda_mm y moneda_mm_utilidad renderizan igual (miles con separadores
  // castellano peruano). El discriminador esta reservado para futuros
  // formatos (moneda_utilidad con paren de negativos, etc.).
  return v.toLocaleString("es-PE", { maximumFractionDigits: 0 });
}

// ============================================================================
// Component
// ============================================================================

export function DashboardMockup() {
  const { entidades, propiaIdx, periodoLabel, filas } = mockupData;

  // Agrupar filas por seccion en el orden en que aparecen (input order).
  const grupos = filas.reduce<Array<{ seccion: Seccion; items: FilaJson[] }>>(
    (acc, f) => {
      const last = acc[acc.length - 1];
      if (last && last.seccion === f.seccion) last.items.push(f);
      else acc.push({ seccion: f.seccion, items: [f] });
      return acc;
    },
    [],
  );

  return (
    <div className="relative">
      {/* Halo/glow decorativo detras del mockup */}
      <div
        aria-hidden
        className="absolute -inset-4 bg-gradient-to-br from-brand-500/10 via-transparent to-brand-500/10 blur-3xl rounded-3xl"
      />
      <div className="relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl shadow-slate-900/10 overflow-hidden">
        {/* Header estilo browser chrome — refuerza que es una app real */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
          </div>
          <div className="ml-3 flex-1 h-6 px-3 flex items-center bg-white rounded-md border border-slate-200 text-[11px] text-slate-500 font-mono">
            aibenchef.azoramind.com/dashboard/informe
          </div>
        </div>

        {/* Sub-header del dashboard — periodo viene del JSON */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Informe Ejecutivo · Cierre {periodoLabel}
            </p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">
              Banco de Crédito del Perú
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            {entidades
              .filter((_, i) => i !== propiaIdx)
              .map((e) => (
                <span
                  key={e}
                  className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-slate-700"
                >
                  {e}
                </span>
              ))}
          </div>
        </div>

        {/* Tabla del cuadro resumen */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#FFC000] text-slate-900 border-b-2 border-slate-900/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider uppercase">
                  Cuadro Resumen
                </th>
                {entidades.map((e, i) => (
                  <th
                    key={e}
                    className={`px-4 py-2.5 text-right text-[11px] font-semibold tracking-wider ${
                      i === propiaIdx
                        ? "bg-slate-900 text-[#FFC000] font-bold"
                        : "text-slate-900"
                    }`}
                  >
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => (
                <>
                  <tr key={`sec-${grupo.seccion}`} className="bg-slate-50">
                    <td
                      colSpan={entidades.length + 1}
                      className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold"
                    >
                      {seccionLabels[grupo.seccion]}
                    </td>
                  </tr>
                  {grupo.items.map((f) => {
                    const tiers = computeTiers(f.valores, f.signo);
                    return (
                      <tr key={f.label} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-700 text-[12.5px]">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 mr-2 align-middle" />
                          {f.label}
                        </td>
                        {f.valores.map((v, i) => {
                          const esPropio = i === propiaIdx;
                          const cellStyle = esPropio
                            ? "bg-amber-50 text-slate-900 font-semibold"
                            : tierStyle[tiers[i]!];
                          return (
                            <td
                              key={i}
                              className={`px-4 py-2 text-right tabular-nums text-[12.5px] ${cellStyle}`}
                            >
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

        {/* Footer con leyenda de heatmap */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2 text-[10px] text-slate-500">
          <span>Fuentes públicas oficiales · Análisis procesado por Aibenchef</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-100" /> Mejor 25%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-white ring-1 ring-slate-200" />{" "}
              Cerca mediana
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-100" /> Peor 25%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

