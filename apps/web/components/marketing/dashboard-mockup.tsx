/**
 * Mockup visual del /dashboard/informe (Cuadro Resumen) — usado en el
 * landing publico como preview del producto. Data REAL publica SBS de
 * la Banca Multiple peruana al cierre Jun 2026. Cero screenshots PNG:
 * componente React puro con Tailwind — responsive y sin peso de imagen.
 *
 * Renderiza el "hero visual" del producto: tabla de 5 columnas
 * (entidad propia + 4 peers) x 8 filas de metricas clave, con
 * heatmap por celda (verde = mejor 25%, rojo = peor 25%).
 *
 * Uso: se embebe en el Hero (debajo del texto CTA) o en la seccion
 * ProductShowcase (como preview del modulo Informe).
 */

const entidades = ["BCP", "BBVA", "Interbank", "Scotiabank", "Pichincha"] as const;
const ENTIDAD_PROPIA_IDX = 0; // BCP siempre en la primera columna

type Fila = {
  label: string;
  seccion: "cartera" | "calidad" | "rentabilidad";
  valores: number[];
  format: "moneda_mm" | "pct" | "moneda_mm_utilidad";
  /** signo: -1 = menor es mejor (mora); 1 = mayor es mejor (rent) */
  signo: 1 | -1;
};

// Data publica SBS Jun 2026 (aproximada, fines demostrativos del landing)
const filas: Fila[] = [
  { label: "Cartera Bruta (MM S/)", seccion: "cartera", valores: [132228, 89451, 55240, 60128, 12580], format: "moneda_mm", signo: 1 },
  { label: "Crec. Cartera YoY", seccion: "cartera", valores: [10.93, 8.42, 6.17, 5.88, 12.15], format: "pct", signo: 1 },
  { label: "% Créditos Atrasados", seccion: "calidad", valores: [2.73, 3.51, 4.21, 4.02, 4.87], format: "pct", signo: -1 },
  { label: "% Mora Global (sin V/C)", seccion: "calidad", valores: [5.55, 6.42, 7.83, 7.11, 9.43], format: "pct", signo: -1 },
  { label: "Cobertura CAR (%)", seccion: "calidad", valores: [127.94, 118.44, 108.22, 112.51, 101.09], format: "pct", signo: 1 },
  { label: "Utilidad Neta (MM S/)", seccion: "rentabilidad", valores: [7008, 3245, 1782, 1911, 72], format: "moneda_mm_utilidad", signo: 1 },
  { label: "% ROE", seccion: "rentabilidad", valores: [27.18, 22.44, 18.90, 20.15, 15.79], format: "pct", signo: 1 },
  { label: "% ROA", seccion: "rentabilidad", valores: [3.44, 2.81, 2.11, 2.35, 2.50], format: "pct", signo: 1 },
];

const seccionLabels: Record<Fila["seccion"], string> = {
  cartera: "Cartera",
  calidad: "Calidad de Cartera",
  rentabilidad: "Rentabilidad",
};

function computeTiers(valores: number[], signo: 1 | -1): Array<"top" | "high" | "mid" | "low" | "bottom"> {
  // Ranking simple: mejor cuartil, sobre mediana, bajo mediana, peor cuartil
  const idx = valores.map((v, i) => ({ v, i })).sort((a, b) => signo === 1 ? b.v - a.v : a.v - b.v);
  const tiers: Array<"top" | "high" | "mid" | "low" | "bottom"> = new Array(valores.length).fill("mid");
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

function formatValor(v: number, format: Fila["format"]): string {
  if (format === "pct") return `${v.toFixed(2)}%`;
  if (format === "moneda_mm") return v.toLocaleString("es-PE", { maximumFractionDigits: 0 });
  if (format === "moneda_mm_utilidad") return v.toLocaleString("es-PE", { maximumFractionDigits: 0 });
  return String(v);
}

export function DashboardMockup() {
  // Agrupar filas por seccion en el orden en que aparecen
  const grupos = filas.reduce<Array<{ seccion: Fila["seccion"]; items: Fila[] }>>((acc, f) => {
    const last = acc[acc.length - 1];
    if (last && last.seccion === f.seccion) last.items.push(f);
    else acc.push({ seccion: f.seccion, items: [f] });
    return acc;
  }, []);

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

        {/* Sub-header del dashboard */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Informe Ejecutivo · Cierre Jun 2026
            </p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">Banco de Crédito del Perú</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            {entidades.slice(1).map((e) => (
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
              <tr className="bg-slate-900 text-white">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider uppercase">
                  Cuadro Resumen
                </th>
                {entidades.map((e, i) => (
                  <th
                    key={e}
                    className={`px-4 py-2.5 text-right text-[11px] font-semibold tracking-wider ${
                      i === ENTIDAD_PROPIA_IDX ? "bg-brand-700" : ""
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
                          const esPropio = i === ENTIDAD_PROPIA_IDX;
                          const cellStyle = esPropio
                            ? "bg-brand-50 text-brand-900 font-semibold"
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
          <span>
            Fuente pública oficial · Data procesada por Aibenchef
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
    </div>
  );
}
